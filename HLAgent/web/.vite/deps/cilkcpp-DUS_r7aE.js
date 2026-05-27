import { r as __exportAll } from "./react-B35R_oEX.js";
import { t as cpp } from "./cpp-kcs4wS8M.js";
//#region node_modules/refractor/lang/cilkcpp.js
/**
* @import {Refractor} from '../lib/core.js'
*/
var cilkcpp_exports = /* @__PURE__ */ __exportAll({ default: () => cilkcpp });
cilkcpp.displayName = "cilkcpp";
cilkcpp.aliases = ["cilk", "cilk-cpp"];
/** @param {Refractor} Prism */
function cilkcpp(Prism) {
	Prism.register(cpp);
	Prism.languages.cilkcpp = Prism.languages.insertBefore("cpp", "function", { "parallel-keyword": {
		pattern: /\bcilk_(?:for|reducer|s(?:cope|pawn|ync))\b/,
		alias: "keyword"
	} });
	Prism.languages["cilk-cpp"] = Prism.languages["cilkcpp"];
	Prism.languages["cilk"] = Prism.languages["cilkcpp"];
}
//#endregion
export { cilkcpp_exports as n, cilkcpp as t };

//# sourceMappingURL=cilkcpp-DUS_r7aE.js.map