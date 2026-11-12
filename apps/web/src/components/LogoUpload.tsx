import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { deleteLogo, getLogo, uploadLogo } from "../server/functions/logo.ts";
import { ImageUpload } from "./ImageUpload.tsx";

const TEXTS = {
  name: "Logo",
  empty: "Noch kein Logo.",
  alt: "Aktuelles Logo",
  fileLabel: "Logodatei",
  upload: "Logo hochladen",
  replace: "Anderes Logo wählen",
  saved: "Logo gespeichert. Es gilt für alles, was ab jetzt erzeugt wird.",
  removed: "Logo entfernt.",
  tooBig: "Das Logo darf höchstens 1 MB groß sein.",
};

/** Logo hochladen oder entfernen, in den Einstellungen und im Panel der Vorschau */
export function LogoUpload({
  sha256,
  onChanged,
  disabled,
  describedBy,
}: {
  sha256: string | null;
  onChanged?: (sha256: string | null) => unknown;
  disabled?: boolean | undefined;
  describedBy?: string | undefined;
}) {
  const upload = useServerFn(uploadLogo);
  const remove = useServerFn(deleteLogo);
  const load = useServerFn(getLogo);
  const router = useRouter();
  // Das Logo kann das Zeichen der Navigation sein (#504): /_app neu laden, damit getAuthState die neue Adresse
  // liefert; die Seite selbst (etwa der Editor mit seinem Formular) bleibt
  const changed = async (sha256: string | null) => {
    await onChanged?.(sha256);
    await router.invalidate({ filter: (match) => match.routeId === "/_app" });
  };
  return (
    <ImageUpload
      sha256={sha256}
      url="/api/logo"
      maxBytes={1024 * 1024}
      texts={TEXTS}
      upload={upload}
      remove={() => remove()}
      load={() => load()}
      onChanged={changed}
      disabled={disabled}
      describedBy={describedBy}
    />
  );
}
