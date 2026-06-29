import { init } from './app';

const $ = require( 'jquery' );
const mw = require( 'mw' );

$.when(
	$.ready,
	mw.loader.using( [
		'mediawiki.api',
		'mediawiki.ForeignApi',
		'mediawiki.util',
	] )
).done( init );
