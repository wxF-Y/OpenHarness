import { r as __exportAll } from "./react-B35R_oEX.js";
//#region node_modules/refractor/lang/editorconfig.js
var editorconfig_exports = /* @__PURE__ */ __exportAll({ default: () => editorconfig });
/**
* @import {Refractor} from '../lib/core.js'
*/
editorconfig.displayName = "editorconfig";
editorconfig.aliases = [];
/** @param {Refractor} Prism */
function editorconfig(Prism) {
	Prism.languages.editorconfig = {
		comment: /[;#].*/,
		section: {
			pattern: /(^[ \t]*)\[.+\]/m,
			lookbehind: true,
			alias: "selector",
			inside: {
				regex: /\\\\[\[\]{},!?.*]/,
				operator: /[!?]|\.\.|\*{1,2}/,
				punctuation: /[\[\]{},]/
			}
		},
		key: {
			pattern: /(^[ \t]*)[^\s=]+(?=[ \t]*=)/m,
			lookbehind: true,
			alias: "attr-name"
		},
		value: {
			pattern: /=.*/,
			alias: "attr-value",
			inside: { punctuation: /^=/ }
		}
	};
}
//#endregion
export { editorconfig_exports as n, editorconfig as t };

//# sourceMappingURL=editorconfig-CAi1nSQu.js.map