import { r as __exportAll } from "./react-B35R_oEX.js";
//#region node_modules/refractor/lang/hsts.js
var hsts_exports = /* @__PURE__ */ __exportAll({ default: () => hsts });
/**
* @import {Refractor} from '../lib/core.js'
*/
hsts.displayName = "hsts";
hsts.aliases = [];
/** @param {Refractor} Prism */
function hsts(Prism) {
	/**
	* Original by Scott Helme.
	*
	* Reference: https://scotthelme.co.uk/hsts-cheat-sheet/
	*/
	Prism.languages.hsts = {
		directive: {
			pattern: /\b(?:includeSubDomains|max-age|preload)(?=[\s;=]|$)/i,
			alias: "property"
		},
		operator: /=/,
		punctuation: /;/
	};
}
//#endregion
export { hsts_exports as n, hsts as t };

//# sourceMappingURL=hsts-shWMY48u.js.map