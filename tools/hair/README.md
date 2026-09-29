# Hair transplant

`transplant.py` moves a donor VRoid model's hair onto one of our characters: the hair mesh, its hair bones
(grafted under the character's head bone) and its spring chains (colliders matched by bone), fitted by the
head joint and face width. The character's old hair and its springs are removed; the scalp cap takes the
donor's own cap (or the hair colour for hair-only samples).

```bash
B=/Applications/Blender.app/Contents/MacOS/Blender
$B --background --python tools/hair/transplant.py -- <character.vrm> <donor.vrm> <out.vrm> [#hair_hex]
python3 tools/vrm_check.py <out.vrm>
```

Donors (CC0, pixiv VRoid samples; see `models/avatar/donors/PROVENANCE.txt`): AvatarSample_D (sleek bob),
E (rounded bob), F (silver short), G (long gradient), HairSample_Female (twin tails), HairSample_Male.
The four AvatarSamples also embed pixiv's VRoid Hub licence: modification, redistribution, personal and
corporate commercial use allowed, no credit required. The donor files themselves are not in git (re-download:
https://opengameart.org/content/vroid-studio-cc0-models; checksums in SHA256SUMS.txt).
