import { r as __exportAll } from "./react-B35R_oEX.js";
//#region node_modules/refractor/lang/bbcode.js
var bbcode_exports = /* @__PURE__ */ __exportAll({ default: () => bbcode });
/**
* @import {Refractor} from '../lib/core.js'
*/
bbcode.displayName = "bbcode";
bbcode.aliases = ["shortcode"];
/** @param {Refractor} Prism */
function bbcode(Prism) {
	Prism.languages.bbcode = { tag: {
		pattern: /\[\/?[^\s=\]]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'"\]=]+))?(?:\s+[^\s=\]]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'"\]=]+))*\s*\]/,
		inside: {
			tag: {
				pattern: /^\[\/?[^\s=\]]+/,
				inside: { punctuation: /^\[\/?/ }
			},
			"attr-value": {
				pattern: /=\s*(?:"[^"]*"|'[^']*'|[^\s'"\]=]+)/,
				inside: { punctuation: [/^=/, {
					pattern: /^(\s*)["']|["']$/,
					lookbehind: true
				}] }
			},
			punctuation: /\]/,
			"attr-name": /[^\s=\]]+/
		}
	} };
	Prism.languages.shortcode = Prism.languages.bbcode;
}
//#endregion
export { bbcode_exports as n, bbcode as t };

//# sourceMappingURL=bbcode-D1z93d7H.js.map