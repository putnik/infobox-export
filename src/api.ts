import type { KeyValue } from './types/main';
import type { ApiResponse, MediaWikiApi, SparqlResponse } from './types/api';

// Timeout on every request so a stalled call can't hang the gadget for good.
const REQUEST_TIMEOUT: number = 30000;

let api: any = null;
let wdApi: any = null;

function getApi(): MediaWikiApi {
	if ( api === null ) {
		const mw = require( 'mw' );
		api = new mw.Api( { ajax: { timeout: REQUEST_TIMEOUT } } );
	}
	return api;
}

export function getWdApi(): MediaWikiApi {
	if ( wdApi === null ) {
		const mw = require( 'mw' );
		wdApi = new mw.ForeignApi( '//www.wikidata.org/w/api.php', { ajax: { timeout: REQUEST_TIMEOUT } } );
	}
	return wdApi;
}

export async function apiRequest( params: KeyValue ): Promise<ApiResponse> {
	try {
		return params.titles && params.titles.length > 20 ?
			await getApi().post( params ) :
			await getApi().get( params );
	} catch ( error ) {
		return {} as ApiResponse;
	}
}

export async function wdApiRequest( params: KeyValue ): Promise<ApiResponse> {
	try {
		return params.titles && params.titles.length > 20 ?
			await getWdApi().post( params ) :
			await getWdApi().get( params );
	} catch ( error ) {
		return {} as ApiResponse;
	}
}

export async function getMessages( messageKeys: string[], language: string ): Promise<ApiResponse> {
	try {
		return await getApi().getMessages( messageKeys, { amlang: language } );
	} catch ( error ) {
		return {} as ApiResponse;
	}
}

export async function sparqlRequest( request: string ): Promise<SparqlResponse> {
	const $ = require( 'jquery' );
	const url: string = 'https://query.wikidata.org/sparql?format=json';
	try {
		return await $.ajax( {
			url: url,
			method: 'POST',
			data: { query: request },
			timeout: REQUEST_TIMEOUT
		} );
	} catch ( error ) {
		return { results: { bindings: [] } } as SparqlResponse;
	}
}
