# Crunchyroll tools

This folder is an unpacked Opera GX extension. It remembers the last Crunchyroll profile, clicks skip controls the player already shows, and adds a MyAnimeList score on a series page.

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

Remember the last profile stores the profile tile you click and the avatar in the site header. On the profile gate it clicks that profile once per page load. It matches the avatar address first, then the visible name.

Skip promos clicks the Skip button that contains the skip icon. After the page loads and playback starts, that button has `aria-hidden="false"` for the first 5 seconds. The extension clicks it once in that window. It does not click the button after those 5 seconds, and it does not click it while `aria-hidden` is `true`.

Skip intros clicks a shown intro control in the first half of the episode.

Skip outros clicks a shown credits, outro, or ending control. An intro control past the halfway point counts as credits.

Skip recaps clicks a shown recap control.

Show the MyAnimeList score adds a link on a series page and on a watch page. On a watch page it sits with Fill page, after the current episode header. On a series page it stays fixed at the top right. The link text looks like `MAL 8.21` and opens that anime on MyAnimeList. A stored score refreshes after 7 days. A title with no close match is tried again after a short wait.

Fill the watch page player adds a Fill page button on a watch page, directly after the current episode header. With the setting on, a watch page opens already filled. You do not have to wait for the button and click it. The filled layout sets `.erc-watch-episode-layout .video-player-spacer` to `max-height: 95vh`, `height: 100vw`, and `min-height: calc(20rem * .5625)`, each with `!important`, and removes the div whose class starts with `app-layout__header`. Two seconds later it checks again and removes that header if fill is still on. It does not remove other divs. One second after fill starts, each `div` with class `kat:transition-opacity` gets inline opacity 0. Hovering that div sets opacity to 1 until the pointer leaves. The `100vw` height keeps the whole video on screen when the window is resized. Exit fill removes that rule and puts the header back. Leaving the watch page does the same. The next watch page starts filled again. The button does not change the video time.

## The skip limit

The extension never seeks. It does not set the video current time. It only clicks a button that is already in the player.

The promo click happens only while `aria-hidden` is `false` and the playing video is still inside its first 5 seconds. Intro, recap, and credits controls are clicked only after `kat:opacity-0` is gone. A pre-roll with no skip control stays on screen.
