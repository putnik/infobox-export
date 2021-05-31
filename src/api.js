const mw = require('mw');

let api = null;
let wdApi = null;

function getApi() {
	if ( api === null ) {
		api = new mw.Api();
	}
	return api;
}

export function getWdApi() {
	if ( wdApi === null ) {
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
