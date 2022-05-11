import { KeyValue } from './types/main';
import { ApiResponse, MediaWikiApi, SparqlResponse } from './types/api';

let api: any = null;
let wdApi: any = null;

function getApi(): MediaWikiApi {
	if ( api === null ) {
		const mw = require( 'mw' );
		api = new mw.Api();
	}
	return api;
}

export function getWdApi(): MediaWikiApi {
	if ( wdApi === null ) {
		const mw = require( 'mw' );
		wdApi = new mw.ForeignApi( '//www.wikidata.org/w/api.php' );
	}
	return wdApi;
}

export async function apiRequest( params: KeyValue ): Promise<ApiResponse> {
	if ( params.titles && params.titles.length > 20 ) {
		return getApi().post( params );
	} else {
		return getApi().get( params );
	}
}

export async function wdApiRequest( params: KeyValue ): Promise<ApiResponse> {
	if ( params.titles && params.titles.length > 20 ) {
		return getWdApi().post( params );
	} else {
		return getWdApi().get( params );
	}
}

export async function getMessages( messageKeys: string[], language: string ): Promise<ApiResponse> {
	return getApi().getMessages( messageKeys, { amlang: language } );
}

export async function sparqlRequest( request: string ): Promise<SparqlResponse> {
	const $ = require( 'jquery' );
	const url = 'https://query.wikidata.org/sparql?format=json';
	return $.post( url, { query: request } );
}
