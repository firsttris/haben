/* Nachbildung von libotto.so für Tests der koffi-Anbindung. Kein echtes Otto. */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
typedef struct { int dummy; } Instanz;
typedef struct { char* daten; uint64_t groesse; } Puffer;
int OttoInstanzErzeugen(const char* log, void* cb, void* ud, Instanz** out){ *out = calloc(1,sizeof(Instanz)); return 0; }
int OttoInstanzFreigeben(Instanz* i){ free(i); return 0; }
int OttoRueckgabepufferErzeugen(Instanz* i, Puffer** out){ *out = calloc(1,sizeof(Puffer)); return 0; }
const void* OttoRueckgabepufferInhalt(Puffer* p){ return p->daten; }
uint64_t OttoRueckgabepufferGroesse(Puffer* p){ return p->groesse; }
int OttoRueckgabepufferFreigeben(Puffer* p){ free(p->daten); free(p); return 0; }
const char* OttoHoleFehlertext(int c){ return c==610 ? "Objekt nicht gefunden" : "?"; }
int OttoDatenAbholen(Instanz* i, const char* id, uint32_t groesse, const char* cert, const char* pin, const char* hid, const char* abhol, Puffer* p){
  if (strcmp(id,"fehlt")==0) return 610;
  /* Binärdaten mit Nullbyte, Größe und PIN im Inhalt zum Prüfen */
  char b[128]; int n = snprintf(b,128,"%%PDF-%s|%u|%s|%s", id, groesse, pin, hid);
  b[4] = 0;
  p->daten = malloc(n); memcpy(p->daten,b,n); p->groesse = n;
  return 0;
}
