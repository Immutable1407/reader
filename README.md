# PR #160 UI evidence — 2026-11-12

Screenshots are unedited captures of an isolated local Electron development build, using the public Oze PDF already included in the upstream repository. No private library, account configuration or conversation is included.

- Upstream baseline: `8319eb9e91ae09c7b385aa5095122d23c0485e12`.
- Proposed code: `4dd6c3d0c01e0c9392014fb453e0f17175059d58`.
- Both builds use the same current backend, CSS, sample library and window dimensions. The baseline frontend uses the upstream NavigationTree component; the proposed frontend uses the PR component. The existing active-item/chapter-location calculation is unchanged.

| File | Observation |
| --- | --- |
| 01-before.png | Source document at page 13; baseline navigation remains at the beginning. |
| 02-after.png | Same page and document after the change; the current upstream-selected item and end of the outline are brought into view. |
| 03-return-to-contents.png | After manually browsing the outline, switching to Search and back to Contents resumes following. |
| 04-manual-browsing.png | While staying on page 7, manually browsing the outline and continuing within the same section does not reset the outline. |
| 05-collapsed-ancestor.png | Page 8 is within section 4.3; its section 4 ancestor remains collapsed and visible. No automatic expansion or navigation edit occurs. |
| 06-selection-pauses-follow.png | While multiselect is active, the source moves to page 13 and navigation remains at the user-selected scroll position. |
| 07-follow-resumed.png | Leaving multiselect resumes following the current upstream-selected item. |

The public paper's printed page numbers differ from the PDF page index; the bottom page control shows the PDF index used in the steps above.
