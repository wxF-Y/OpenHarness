import { r as __exportAll } from "./react-B35R_oEX.js";
import { t as php } from "./php-DXUZ7Sgd.js";
//#region node_modules/refractor/lang/php-extras.js
/**
* @import {Refractor} from '../lib/core.js'
*/
var php_extras_exports = /* @__PURE__ */ __exportAll({ default: () => phpExtras });
phpExtras.displayName = "php-extras";
phpExtras.aliases = [];
/** @param {Refractor} Prism */
function phpExtras(Prism) {
	Prism.register(php);
	Prism.languages.insertBefore("php", "variable", {
		this: {
			pattern: /\$this\b/,
			alias: "keyword"
		},
		global: /\$(?:GLOBALS|HTTP_RAW_POST_DATA|_(?:COOKIE|ENV|FILES|GET|POST|REQUEST|SERVER|SESSION)|argc|argv|http_response_header|php_errormsg)\b/,
		scope: {
			pattern: /\b[\w\\]+::/,
			inside: {
				keyword: /\b(?:parent|self|static)\b/,
				punctuation: /::|\\/
			}
		}
	});
}
//#endregion
export { php_extras_exports as n, phpExtras as t };

//# sourceMappingURL=php-extras-Cb9W6zFv.js.map