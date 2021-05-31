let api = null;
let wdApi = null;

function getApi() {
	if ( api === null ) {
		const mw = require('mw');
		api = new mw.Api();
	}
	return api;
}

export function getWdApi() {
	if ( wdApi === null ) {
		const mw = require('mw');
		wdApi = new mw.ForeignApi( '//www.wikidata.org/w/api.php' );
	}
	return wdApi;
}

export function apiRequest( params ) {
	return getApi().get( params );
}

export function wdApiRequest( params ) {
	return getWdApi().get( params );
}

export function getMessages( messageKeys, language ) {
	return getApi().getMessages( messageKeys, { amlang: language } );
}

export function sparqlRequest( request ) {
	const $ = require('jquery');
	const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent( request );
	return $.get( url );
}
