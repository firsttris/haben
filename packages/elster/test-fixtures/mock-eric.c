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
  if (strstr(d,"CRASH")) { *(volatile int*)0 = 1; }
  return 0;
}
