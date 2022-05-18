[![License: MIT](https://img.shields.io/badge/License-MIT-lightgrey.svg)](/LICENSE.md)
[![Checks status](https://github.com/putnik/infobox-export/workflows/checks/badge.svg)](https://github.com/putnik/infobox-export/actions/workflows/checks.yml)

Gadget for export information from Wikipedia infoboxes to Wikidata.

See [description](https://www.wikidata.org/wiki/Special:MyLanguage/Help:Infobox_export_gadget) in Wikidata.

## Installation
Builds of this script are published on [MediaWiki:Gadget-infoboxExport.js](https://www.wikidata.org/wiki/MediaWiki:Gadget-infoboxExport.js) page in Wikidata.

To start using it just add this line to your global [common.js](https://www.wikidata.org/wiki/Special:MyPage/common.js):
```js
mw.loader.load( '//www.wikidata.org/w/index.php?title=MediaWiki:Gadget-infoboxExport.js&action=raw&ctype=text/javascript' );
```

On the first few pages, the script will take a long time to load data into the cache.
It needs to get a lot of information about properties and units of measurement (about 50 MB).
After that, the script will run fairly quickly,
except for the moments when the data in the cache expires and needs to be reloaded.

## How to use
When the script is loading data, a loading indicator appears in the infobox header.
After the indicator has disappeared, some fields may turn red.
This means that the corresponding properties in Wikidata are empty,
and you can add values from the infobox to Wikidata.

To start adding a value, just double-click on it.
This will open a window showing which values can be added to which properties (for some values, there may be multiple possible properties).
You can check if the values are correct and choose which ones you want to add.
After that, click on the "Export" button, and the script will add them to Wikidata.
