# CRutility

This is an independent project, not affiliated with, sponsored by, or endorsed by Crunchyroll, MyAnimeList, Tenrai, or the Netflix-Prime-Auto-Skip authors. See the [license](#license) below and [third-party services, privacy, and service terms](docs/THIRD_PARTY_SERVICES.md) for details.

## Install in Opera GX

1. Open `opera://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked.
4. Choose this folder.

After an update, click Reload on this extension's card, then reload the Crunchyroll tab.

The toolbar icon opens the popup. Every toggle starts on.

## Turn a feature on or off

Change a checkbox in the popup. The choice is saved in extension storage. An open Crunchyroll tab picks up the change on its next check.

## What each toggle does

`Remember the last profile` - stores the profile tile you click and the avatar in the site header. On the profile gate it clicks that profile once per page load. It matches the avatar address first, then the visible name.

`Skip promos` - clicks the Skip button that displays on Crunchyrolls server-side injected promos that adblockers cant detect. After the page loads and playback starts, the extension detects the skip button and clicks it within a 5 second window and will not click it after this 5 seconds.

`Skip intros` - clicks a shown intro control in the first half of the episode.

`Skip outros` - clicks a shown credits, outro, or ending control.

`Skip recaps` - clicks a shown recap control.

`Show the MyAnimeList score` - adds a link on a series page and on a watch page. On a watch page it sits with Fill page, after the current episode header. On a series page it will display under the normal ratings. The link text looks like a blue button with `MAL 8.21` and opens that anime on MyAnimeList. A stored score refreshes after 7 days.*


`Fill the watch page player` - adds a Fill page button on a watch page, directly after the current episode header. With the setting on, a watch page opens already filled. Fill works similarly to theatre mode on other apps and attempts to fill the screen horizontally without cutting off video or player controls vertically (These values are CSS related - hardcoded using `vh` and `vw`). It also removes the top menu from the crunchyroll page.

NOTES:
*MAL rating currently only returns the first season of a series.

### Skip Functionality Clarification

The extension never seeks. It does not set the video current time. It only clicks the button that is already in the player for you. Sometimes CR messes up with the placement or timing of these buttons - this will not fix that and will click them if that setting is on.

## License

This extension includes code and inspiration from [Netflix-Prime-Auto-Skip / Streaming enhanced](https://github.com/Dreamlinerm/Netflix-Prime-Auto-Skip), by Marvin Krebber (Dreamlinerm) and contributors, distributed under the [GNU General Public License version 3](https://github.com/Dreamlinerm/Netflix-Prime-Auto-Skip/blob/main/License).

This is a modified, independently maintained project. Its changes include a standalone Opera GX extension, profile and skip controls, fill mode, and Tenrai-backed ratings. License, notice, and API request-handling updates were made on 2026-11-14. The extension source is licensed under **GPL-3.0-only**; the full license is in [LICENSE](LICENSE). Copyright (C) 2026 Fred.



The optional ratings feature obtains MyAnimeList catalogue scores through [Tenrai's unofficial API](https://api.tenrai.org/documentation), not through MyAnimeList's official API. Tenrai do not require attribution but it was a life saver for this tool.

## Disclaimers & Attributions

Crunchyroll is a trademark of Crunchyroll, LLC. MyAnimeList and MAL are marks of MyAnimeList Co., Ltd. Tenrai and other third-party names and marks belong to their respective owners.

See [THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md). The software comes without warranty to the extent permitted by law; mandatory consumer rights remain unaffected.

Further info on use of Third party services and data privacy: [THIRD_PARTY_SERVICES](docs/THIRD_PARTY_SERVICES.md)


