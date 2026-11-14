# Crunchyroll tools

This folder is an unpacked Opera GX extension. It remembers the last Crunchyroll profile, clicks skip controls the player shows, has a theater(fill) mode for player, adds MAL rating with link to page (currently only shows season 1 for multi-season series WIP).

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

`Skip promos` - clicks the Skip button that displays on Crunchyrolls server-side injected promos that adblockers cant detect. After the page loads and playback starts, that button has `aria-hidden="false"` for the first 5 seconds. The extension clicks it once in that window. It does not click the button after those 5 seconds, and it does not click it while `aria-hidden` is `true`.

`Skip intros` - clicks a shown intro control in the first half of the episode.

`Skip outros` - clicks a shown credits, outro, or ending control.

`Skip recaps` - clicks a shown recap control.

`Show the MyAnimeList score` - adds a link on a series page and on a watch page. On a watch page it sits with Fill page, after the current episode header. On a series page it stays fixed at the top right. The link text looks like a blue button with `MAL 8.21` and opens that anime on MyAnimeList. A stored score refreshes after 7 days.

`Fill the watch page player` - adds a Fill page button on a watch page, directly after the current episode header. With the setting on, a watch page opens already filled. Fill works similarly to theatre mode on other apps and attempts to fill the screen horizontally without cutting off video or player controls vertically (These values are CSS related - hardcoded using `vh` and `vw`). It also removes the top menu from the crunchyroll page.

## Skip Functionality Clarification

The extension never seeks. It does not set the video current time. It only clicks the button that is already in the player for you. Sometimes CR messes up with the placement or timing of these buttons - this will not fix that and will click them if that setting is on.
