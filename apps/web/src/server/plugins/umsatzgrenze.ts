import { definePlugin } from "nitro";
import { kleinunternehmerStand } from "../modules/auswertungen/index.ts";
import { belegeUmsatzStand } from "../modules/rechnungen/index.ts";

// Die Rückfrage zur Kleinunternehmergrenze beim Festschreiben braucht den vereinnahmten Umsatz aus `auswertungen`, das
// über `rechnungen` steht (#1108). Hier, wo die Module zusammengesetzt werden, bekommt `rechnungen` ihn einmal beim Start
export default definePlugin(() => {
  belegeUmsatzStand(kleinunternehmerStand);
});
