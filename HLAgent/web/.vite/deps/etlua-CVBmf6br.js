import { r as __exportAll } from "./react-B35R_oEX.js";
import { t as markupTemplating } from "./markup-templating-B9NWxgmT.js";
import { t as lua } from "./lua-B0iahkuq.js";
//#region node_modules/refractor/lang/etlua.js
/**
* @import {Refractor} from '../lib/core.js'
*/
var etlua_exports = /* @__PURE__ */ __exportAll({ default: () => etlua });
etlua.displayName = "etlua";
etlua.aliases = [];
/** @param {Refractor} Prism */
function etlua(Prism) {
	Prism.register(lua);
	Prism.register(markupTemplating);
	(function(Prism) {
		Prism.languages.etlua = {
			delimiter: {
				pattern: /^<%[-=]?|-?%>$/,
				alias: "punctuation"
			},
			"language-lua": {
				pattern: /[\s\S]+/,
				inside: Prism.languages.lua
			}
		};
		Prism.hooks.add("before-tokenize", function(env) {
			Prism.languages["markup-templating"].buildPlaceholders(env, "etlua", /<%[\s\S]+?%>/g);
		});
		Prism.hooks.add("after-tokenize", function(env) {
			Prism.languages["markup-templating"].tokenizePlaceholders(env, "etlua");
		});
	})(Prism);
}
//#endregion
export { etlua_exports as n, etlua as t };

//# sourceMappingURL=etlua-CVBmf6br.js.map