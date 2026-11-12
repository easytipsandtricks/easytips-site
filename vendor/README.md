# vendor — pinned libraries (copied, never fetched)

Byte-identical copies of the EasyTips Studio's `engine/vendor/` files (spec 0006). The page loads them from this folder through an import map; nothing comes from a CDN at runtime. Only the files the 3D story imports are here.

| File | Library | Version | Licence | sha256 |
|---|---|---|---|---|
| `three/three.module.js` | three.js | 0.187.0 | MIT (`three/LICENSE`, © 2010-2026 three.js authors) | `104f56145899722094556490d787aae0617cc2fc3382f31df02d724ea1aee341` |
| `three/three.core.js` | three.js | 0.187.0 | MIT | `613e370f76638fdef83926642bf256dc9615684922de1ce1f63a8583e5d78578` |
| `three/addons/postprocessing/EffectComposer.js` | three.js addon | 0.187.0 | MIT | `4e079a5886152d7e529a59aef644e968ab4d32c6a33ce016b36bf29b2eac26f7` |
| `three/addons/postprocessing/RenderPass.js` | three.js addon | 0.187.0 | MIT | `817f6c3cdcd0fd41515d112359ea0532568eefb5aabd3b33903957ebca1b8a6a` |
| `three/addons/postprocessing/ShaderPass.js` | three.js addon | 0.187.0 | MIT | `e2500a5913b26bbf5148ceaae644c6edcff06a18b01494ee37bf856353d2ab9d` |
| `three/addons/postprocessing/MaskPass.js` | three.js addon | 0.187.0 | MIT | `7cd08eee9d5d6f5578beaddbdcbe9c384f6873810af27f22ab7db3ceeb127aa3` |
| `three/addons/postprocessing/Pass.js` | three.js addon | 0.187.0 | MIT | `444b409c235ead986893c472e720da1b779a56985c7d10b279c7944b52bd61c5` |
| `three/addons/postprocessing/UnrealBloomPass.js` | three.js addon | 0.187.0 | MIT | `ba8f2fcadfa6588384c9473498f974d81d120f02f0e63a0e59c265202a006b5a` |
| `three/addons/postprocessing/OutputPass.js` | three.js addon | 0.187.0 | MIT | `02e4a261af34de71338185e9e87f0cbe5cba9115608d984363e1269dec1d2272` |
| `three/addons/shaders/CopyShader.js` | three.js addon | 0.187.0 | MIT | `a33057d5ac91c43304c186ac0e8816e62bb2ed471d3a00ff3018dfd5c0389718` |
| `three/addons/shaders/LuminosityHighPassShader.js` | three.js addon | 0.187.0 | MIT | `5044f780b6e6cf863947f64c36fe1587132f7fbe395ada863cd1e5f0388dcf1e` |
| `three/addons/shaders/OutputShader.js` | three.js addon | 0.187.0 | MIT | `353479f77a8d7e2629d49ccac9fc2f5dbfdda5442e0adf867b00377a2fcb0cb2` |
| `det.js` | EasyTips Studio helpers (`rng`, `hashSeed`) | studio | same as the site | `73ab5625e0ba4f1ee445939f229e686cbde610c09466fd486eb1b379959247d4` |

Source of the three.js files: https://registry.npmjs.org/three/-/three-0.187.0.tgz (`build/` and `examples/jsm/`), checked against the registry integrity and https://cdn.jsdelivr.net/npm/three@0.187.0/ when the studio vendored them (2026-11-11).

Check: `shasum -a 256 -c` against the table, or in the studio `engine/vendor/VERSIONS.json`.
