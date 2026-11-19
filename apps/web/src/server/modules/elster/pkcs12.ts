import { createDecipheriv, createHash, pbkdf2 } from "node:crypto";
import { promisify } from "node:util";

/*
 * Zertifikate aus einer PKCS#12-Datei (.pfx) lesen, nur so weit, wie das Ablaufdatum der ELSTER-Zertifikatsdatei es
 * braucht (#1366): Aufbau nach RFC 7292, Kap. 4. Die Zertifikate liegen meist mit der PIN verschlüsselt, in Dateien aus
 * Mein ELSTER von 2024 mit pbeWithSHAAnd40BitRC2-CBC, mit neueren Werkzeugen mit PBES2 und AES (RFC 8018). Gezählt werden
 * nur Zertifikate mit localKeyId, also die zu einem Schlüssel der Datei, nicht die der Zertifizierungsstelle. Schlüssel
 * werden nicht entschlüsselt, der MAC nicht geprüft: Mit falscher PIN scheitert schon das Entschlüsseln. Jede
 * Abweichung wirft; certificate-expiry.ts macht daraus „kein Datum“.
 */

/** Mehr rechnet Haben nicht; übliche Dateien haben 2048 bis 100000 Iterationen */
const MAX_ITERATIONS = 1_000_000;

const OID = {
  data: "1.2.840.113549.1.7.1",
  encryptedData: "1.2.840.113549.1.7.6",
  certBag: "1.2.840.113549.1.12.10.1.3",
  safeContentsBag: "1.2.840.113549.1.12.10.1.6",
  x509Certificate: "1.2.840.113549.1.9.22.1",
  localKeyId: "1.2.840.113549.1.9.21",
  pbes2: "1.2.840.113549.1.5.13",
  pbkdf2: "1.2.840.113549.1.5.12",
} as const;

/**
 * RFC 7292, Anhang C: Schlüssel und IV mit SHA-1 aus PIN und Salz (Anhang B). RC2 entschlüsselt node:crypto in Bun
 * (BoringSSL): rc2-40-cbc mit 40, rc2-cbc mit 128 effektiven Bit, genau die beiden Varianten aus PKCS#12.
 */
const PKCS12_PBE: Record<string, { cipher: string; keyLength: number }> = {
  "1.2.840.113549.1.12.1.3": { cipher: "des-ede3-cbc", keyLength: 24 },
  "1.2.840.113549.1.12.1.5": { cipher: "rc2-cbc", keyLength: 16 },
  "1.2.840.113549.1.12.1.6": { cipher: "rc2-40-cbc", keyLength: 5 },
};

/** PBES2: Verfahren und Schlüssellänge, PRF von PBKDF2 (RFC 8018) */
const PBES2_CIPHERS: Record<string, { name: string; keyLength: number }> = {
  "2.16.840.1.101.3.4.1.2": { name: "aes-128-cbc", keyLength: 16 },
  "2.16.840.1.101.3.4.1.22": { name: "aes-192-cbc", keyLength: 24 },
  "2.16.840.1.101.3.4.1.42": { name: "aes-256-cbc", keyLength: 32 },
  "1.2.840.113549.3.7": { name: "des-ede3-cbc", keyLength: 24 },
};
const PBKDF2_PRF: Record<string, string> = {
  "1.2.840.113549.2.7": "sha1",
  "1.2.840.113549.2.8": "sha224",
  "1.2.840.113549.2.9": "sha256",
  "1.2.840.113549.2.10": "sha384",
  "1.2.840.113549.2.11": "sha512",
};

/** DER-Zertifikate zu den Schlüsseln der Datei */
export async function clientCertificates(pfx: Uint8Array, pin: string): Promise<Uint8Array[]> {
  const [, authSafe] = children(read(pfx), 2);
  const [type, content] = children(authSafe!, 2);
  if (oid(type!) !== OID.data) throw new Error("PKCS#12: nur Passwort-Integrität");
  const certificates: Uint8Array[] = [];
  for (const info of children(read(octets(explicit(content!))))) {
    const [infoType, infoContent] = children(info, 2);
    const kind = oid(infoType!);
    if (kind === OID.data) collect(read(octets(explicit(infoContent!))), certificates);
    else if (kind === OID.encryptedData) collect(read(await decryptContent(explicit(infoContent!), pin)), certificates);
  }
  return certificates;
}

/** SafeContents (RFC 7292, Kap. 4.2): Zertifikate mit localKeyId einsammeln */
function collect(safeContents: Der, into: Uint8Array[]): void {
  for (const bag of children(safeContents)) {
    const [bagId, bagValue, attributes] = children(bag, 2);
    const id = oid(bagId!);
    if (id === OID.safeContentsBag) collect(explicit(bagValue!), into);
    if (id !== OID.certBag || !attributes || !children(attributes).some((a) => oid(children(a, 1)[0]!) === OID.localKeyId)) continue;
    const [certId, certValue] = children(explicit(bagValue!), 2);
    if (oid(certId!) === OID.x509Certificate) into.push(octets(explicit(certValue!)));
  }
}

/** EncryptedData (RFC 2315, Kap. 13): Inhalt mit der PIN entschlüsseln */
async function decryptContent(encryptedData: Der, pin: string): Promise<Uint8Array> {
  const [, encryptedContentInfo] = children(encryptedData, 2);
  const [, algorithm, encryptedContent] = children(encryptedContentInfo!, 3);
  // [0] IMPLICIT OCTET STRING, einfach (0x80) oder zusammengesetzt (0xa0)
  if ((encryptedContent!.tag & 0xdf) !== 0x80) throw new Error("PKCS#12: kein verschlüsselter Inhalt");
  const [algorithmId, parameters] = children(algorithm!, 2);
  const id = oid(algorithmId!);
  const data = octets(encryptedContent!);
  if (id === OID.pbes2) return decryptPbes2(parameters!, pin, data);
  const pbe = PKCS12_PBE[id];
  if (!pbe) throw new Error(`PKCS#12: Verfahren ${id} unbekannt`);
  const [salt, iterationCount] = children(parameters!, 2);
  const iterations = checkedIterations(integer(iterationCount!));
  const password = bmpPassword(pin);
  const key = pkcs12Kdf(password, octets(salt!), iterations, 1, pbe.keyLength);
  const iv = pkcs12Kdf(password, octets(salt!), iterations, 2, 8);
  return decipher(pbe.cipher, key, iv, data);
}

/** PBES2 mit PBKDF2 (RFC 8018, Kap. 6.2 und 5.2); das Passwort geht als UTF-8 hinein */
async function decryptPbes2(parameters: Der, pin: string, data: Uint8Array): Promise<Uint8Array> {
  const [kdf, scheme] = children(parameters, 2);
  const [kdfId, kdfParameters] = children(kdf!, 2);
  if (oid(kdfId!) !== OID.pbkdf2) throw new Error("PBES2: nur PBKDF2");
  const [salt, iterationCount, ...rest] = children(kdfParameters!, 2);
  if (salt!.tag !== 0x04) throw new Error("PBKDF2: Salz nur als OCTET STRING");
  const prfNode = rest.find((node) => node.tag === 0x30);
  const digest = prfNode ? PBKDF2_PRF[oid(children(prfNode, 1)[0]!)] : "sha1";
  const [schemeId, iv] = children(scheme!, 2);
  const cipher = PBES2_CIPHERS[oid(schemeId!)];
  if (!digest || !cipher) throw new Error("PBES2: Verfahren unbekannt");
  const iterations = checkedIterations(integer(iterationCount!));
  const key = await promisify(pbkdf2)(Buffer.from(pin, "utf8"), octets(salt!), iterations, cipher.keyLength, digest);
  return decipher(cipher.name, key, octets(iv!), data);
}

function decipher(name: string, key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const d = createDecipheriv(name, key, iv);
  return new Uint8Array(Buffer.concat([d.update(data), d.final()]));
}

function checkedIterations(n: number): number {
  if (n < 1 || n > MAX_ITERATIONS) throw new Error(`PKCS#12: ${n} Iterationen`);
  return n;
}

/** RFC 7292, Anhang B.1: BMPString, zwei Bytes je Zeichen, mit zwei Nullbytes am Ende */
function bmpPassword(pin: string): Uint8Array {
  const bytes = new Uint8Array(pin.length * 2 + 2);
  for (let i = 0; i < pin.length; i++) {
    bytes[2 * i] = pin.charCodeAt(i) >>> 8;
    bytes[2 * i + 1] = pin.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/** RFC 7292, Anhang B.2 mit SHA-1 (u = 160, v = 512 Bit); id 1 für den Schlüssel, 2 für den IV */
function pkcs12Kdf(password: Uint8Array, salt: Uint8Array, iterations: number, id: number, n: number): Uint8Array {
  const u = 20;
  const v = 64;
  const repeat = (source: Uint8Array) => Uint8Array.from({ length: v * Math.ceil(source.length / v) }, (_, i) => source[i % source.length]!);
  const i = Buffer.concat([repeat(salt), repeat(password)]);
  const d = new Uint8Array(v).fill(id);
  const result = new Uint8Array(Math.ceil(n / u) * u);
  for (let round = 0; round * u < n; round++) {
    let a = createHash("sha1").update(d).update(i).digest();
    for (let r = 1; r < iterations; r++) a = createHash("sha1").update(a).digest();
    result.set(a, round * u);
    // I_j = (I_j + B + 1) mod 2^v für jeden Block, B aus Wiederholungen von A
    const b = repeat(a).subarray(0, v);
    for (let block = 0; block < i.length; block += v) {
      let carry = 1;
      for (let k = v - 1; k >= 0; k--) {
        const sum = i[block + k]! + b[k]! + carry;
        i[block + k] = sum & 0xff;
        carry = sum >>> 8;
      }
    }
  }
  return result.subarray(0, n);
}

/* Kleinster Leser für DER mit fester Länge, wie ihn PKCS#12 braucht; BER mit unbestimmter Länge wird abgelehnt. */

interface Der {
  tag: number;
  content: Uint8Array;
}

function read(bytes: Uint8Array): Der {
  const { node, end } = readAt(bytes, 0);
  if (end !== bytes.length) throw new Error("DER: Daten nach dem Ende");
  return node;
}

function readAt(bytes: Uint8Array, offset: number): { node: Der; end: number } {
  const tag = bytes[offset];
  const first = bytes[offset + 1];
  if (tag === undefined || first === undefined || (tag & 0x1f) === 0x1f) throw new Error("DER: Kennung");
  let length = first;
  let start = offset + 2;
  if (first & 0x80) {
    const count = first & 0x7f;
    if (count === 0 || count > 3) throw new Error("DER: Länge");
    length = 0;
    for (let k = 0; k < count; k++) length = length * 256 + bytes[start + k]!;
    start += count;
  }
  if (start + length > bytes.length) throw new Error("DER: abgeschnitten");
  return { node: { tag, content: bytes.subarray(start, start + length) }, end: start + length };
}

/** Kinder eines zusammengesetzten Elements; mindestens `min`, sonst ist der Aufbau falsch */
function children(node: Der, min = 0): Der[] {
  if (!(node.tag & 0x20)) throw new Error("DER: nicht zusammengesetzt");
  const list: Der[] = [];
  for (let offset = 0; offset < node.content.length; ) {
    const { node: child, end } = readAt(node.content, offset);
    list.push(child);
    offset = end;
  }
  if (list.length < min) throw new Error("DER: zu wenige Elemente");
  return list;
}

/** Inhalt von [0] EXPLICIT */
function explicit(node: Der): Der {
  if (node.tag !== 0xa0) throw new Error("DER: [0] erwartet");
  return children(node, 1)[0]!;
}

/** OCTET STRING, auch zusammengesetzt (BER) oder als [0] IMPLICIT */
function octets(node: Der): Uint8Array {
  if (!(node.tag & 0x20)) return node.content;
  return Buffer.concat(children(node).map(octets));
}

function integer(node: Der): number {
  if (node.tag !== 0x02 || node.content.length > 4) throw new Error("DER: INTEGER");
  return node.content.reduce((n, byte) => n * 256 + byte, 0);
}

function oid(node: Der): string {
  if (node.tag !== 0x06 || node.content.length === 0) throw new Error("DER: OID erwartet");
  const parts: number[] = [];
  let value = 0;
  for (const byte of node.content) {
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  const [first = 0, ...rest] = parts;
  return [first < 80 ? Math.floor(first / 40) : 2, first < 80 ? first % 40 : first - 80, ...rest].join(".");
}
