import { init } from "./app";

const $ = require('jquery');
const mw = require('mw');

$.when(
	$.ready,
	mw.loader.using( [
		'mediawiki.api',
		'mediawiki.ForeignApi',
		'mediawiki.util',
		'oojs-ui-core',
		'oojs-ui-widgets',
		'oojs-ui-windows'
	] )
).done( init );
