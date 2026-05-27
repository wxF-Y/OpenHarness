import { r as __exportAll } from "./react-B35R_oEX.js";
import { t as csharp } from "./csharp-D1YVBWKC.js";
import { t as t4Templating } from "./t4-templating-BzjSuOXP.js";
//#region node_modules/refractor/lang/t4-cs.js
/**
* @import {Refractor} from '../lib/core.js'
*/
var t4_cs_exports = /* @__PURE__ */ __exportAll({ default: () => t4Cs });
t4Cs.displayName = "t4-cs";
t4Cs.aliases = ["t4"];
/** @param {Refractor} Prism */
function t4Cs(Prism) {
	Prism.register(csharp);
	Prism.register(t4Templating);
	Prism.languages.t4 = Prism.languages["t4-cs"] = Prism.languages["t4-templating"].createT4("csharp");
}
//#endregion
export { t4_cs_exports as n, t4Cs as t };

//# sourceMappingURL=t4-cs-B6Jo4dl-.js.map