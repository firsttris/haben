/* Nachbildung von libericapi.so für Tests der koffi-Anbindung. Kein echtes ERiC. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct { char* s; } Puffer;
typedef struct { uint32_t version, vorschau, duplexDruck; const char* pdfName; const char* fussText; void* pdfCallback; void* pdfCallbackBenutzerdaten; } druck_t;
typedef struct { uint32_t version; uint32_t zertifikatHandle; const char* pin; } crypto_t;
static void put(Puffer* p, const char* s){ free(p->s); p->s = strdup(s); }
int EricInitialisiere(const char* plugin, const char* log){ fprintf(stderr,"init %s %s\n",plugin,log); return 0; }
int EricBeende(void){ return 0; }
Puffer* EricRueckgabepufferErzeugen(void){ return calloc(1,sizeof(Puffer)); }
const char* EricRueckgabepufferInhalt(Puffer* p){ return p->s ? p->s : ""; }
int EricRueckgabepufferFreigeben(Puffer* p){ free(p->s); free(p); return 0; }
int EricHoleFehlerText(int c, Puffer* p){ char b[64]; snprintf(b,64,"Text zu %d äö",c); put(p,b); return 0; }
int EricGetHandleToCertificate(uint32_t* h, uint32_t* pin, const char* path){ FILE* f=fopen(path,"rb"); if(!f) return 610201016; fclose(f); *h=42; *pin=1; return 0; }
int EricCloseHandleToCertificate(uint32_t h){ return h==42?0:1; }
int EricDekodiereDaten(uint32_t h, const char* pin, const char* b64, Puffer* p){
  char b[256];
  if (strcmp(b64,"kaputt")==0) return 610301200;
  snprintf(b,256,"<?xml version=\"1.0\" encoding=\"ISO-8859-15\"?><VaSt_RBM version=\"202001\"><Mitteilung><Betrag>12.50</Betrag><Info>%u:%s:%s</Info></Mitteilung></VaSt_RBM>", h, pin, b64);
  put(p,b);
  return 0;
}
int EricBearbeiteVorgang(const char* d, const char* v, uint32_t flags, const druck_t* dr, const crypto_t* cr, uint32_t* th, Puffer* r, Puffer* s){
  char b[512];
  snprintf(b,512,"<R><V>%s</V><F>%u</F><D>%u:%s</D><C>%u:%u:%s</C><L>%zu</L><TH>%p</TH></R>", v, flags, dr?dr->version:0, dr&&dr->pdfName?dr->pdfName:"-", cr?cr->version:0, cr?cr->zertifikatHandle:0, cr&&cr->pin?cr->pin:"-", strlen(d), (void*)th);
  put(r,b);
  if (dr && dr->pdfName){ FILE* f=fopen(dr->pdfName,"wb"); fputs("%PDF-mock",f); fclose(f); }
  if (flags & 4) put(s,"<Elster><TransferHeader><TransferTicket>tt-123</TransferTicket></TransferHeader></Elster>");
  if ((flags & 4) && strcmp(v,"PostfachAnfrage_31")==0) put(s,
    "<Elster xmlns=\"http://www.elster.de/elsterxml/schema/v11\"><DatenTeil><Nutzdatenblock><Nutzdaten>"
    "<Datenabholung xmlns=\"http://finkonsens.de/elster/elsterdatenabholung/v3\" version=\"31\"><PostfachAnfrage>"
    "<DatenartBereitstellung name=\"DivaBescheidESt\" anzahltreffer=\"1\"><Bereitstellung id=\"b-1\" groesse=\"20\">"
    "<Meta name=\"veranlagungszeitraum\">2025</Meta>"
    "<Anhang><Dateibezeichnung>Bescheid</Dateibezeichnung><Dateityp>application/pdf</Dateityp><DateiReferenzId>ref-1</DateiReferenzId><DateiGroesse>12</DateiGroesse></Anhang>"
    "<Anhang><Dateibezeichnung>Weg</Dateibezeichnung><Dateityp>application/pdf</Dateityp><DateiReferenzId>fehlt</DateiReferenzId><DateiGroesse>1</DateiGroesse></Anhang>"
    "</Bereitstellung></DatenartBereitstellung></PostfachAnfrage></Datenabholung></Nutzdaten></Nutzdatenblock></DatenTeil></Elster>");
  if ((flags & 4) && strcmp(v,"ElsterVaStDaten_31")==0 && strstr(d,"<Anfrage")) put(s,
    "<Elster xmlns=\"http://www.elster.de/elsterxml/schema/v11\"><DatenTeil><Nutzdatenblock><Nutzdaten><Datenabholung xmlns=\"http://finkonsens.de/elster/elsterdatenabholung/v3\" version=\"31\">"
    "<Anfrage einschraenkung=\"alle\" veranlagungsjahr=\"2025\" idnr=\"02293417683\">"
    "<Id groesse=\"1600\" belegart=\"VaSt_RBM\" hashwert=\"h1\" schemaversion=\"202001\">a-1\n</Id>"
    "<Id groesse=\"900\" belegart=\"VaSt_KRV\" hashwert=\"h2\" schemaversion=\"1\">a-2</Id>"
    "<Id groesse=\"900\" belegart=\"VaSt_LStB\" hashwert=\"h3\" schemaversion=\"1\">a-3</Id>"
    "</Anfrage></Datenabholung></Nutzdaten></Nutzdatenblock></DatenTeil></Elster>");
  if ((flags & 4) && strcmp(v,"ElsterVaStDaten_31")==0 && strstr(d,"<Abholung")) {
    /* a-2 ist kaputt verschlüsselt, a-3 fehlt in der Antwort; TH zeigt, dass ein Transferhandle kam */
    char a[1024];
    snprintf(a,1024,"<Elster><DatenTeil><Nutzdatenblock><Nutzdaten><Datenabholung xmlns=\"http://finkonsens.de/elster/elsterdatenabholung/v3\" version=\"31\">"
      "<Abholung id=\"a-1\" idnr=\"02293417683\" veranlagungsjahr=\"2025\"><Datenpaket>QUJD\\r\\nREVG\n</Datenpaket></Abholung>"
      "<Abholung id=\"a-2\"><Datenpaket>kaputt</Datenpaket></Abholung>"
      "</Datenabholung></Nutzdaten></Nutzdatenblock></DatenTeil><TH>%s</TH><N>%d</N></Elster>", th ? "ja" : "nein", (int)(strstr(d,"a-3")!=NULL));
    put(s,a);
  }
  if (strstr(d,"CRASH")) { *(volatile int*)0 = 1; }
  return 0;
}
