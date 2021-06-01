import { KeyValue } from "./types/main";

let api: any = null;
let wdApi: any = null;

function getApi(): any {
	if ( api === null ) {
		const mw = require('mw');
		api = new mw.Api();
	}
	return api;
}

export function getWdApi(): any {
	if ( wdApi === null ) {
		const mw = require('mw');
		wdApi = new mw.ForeignApi( '//www.wikidata.org/w/api.php' );
	}
	return wdApi;
}

export function apiRequest( params: KeyValue ): any {
	return getApi().get( params );
}

export function wdApiRequest( params: KeyValue ): any {
	return getWdApi().get( params );
}

export function getMessages( messageKeys: string[], language: string ): Promise<any> {
	return getApi().getMessages( messageKeys, { amlang: language } );
}

export function sparqlRequest( request: string ): any {
	const $ = require('jquery');
	const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent( request );
	return $.get( url );
}
