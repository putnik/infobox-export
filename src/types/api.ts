import { KeyValue } from './main';

export type ApiResponse = {
	error?: {
		code: string;
		info: string;
	};
	[ key: string ]: any;
}
export type SparqlResponse = KeyValue

export interface MediaWikiApi {
	get: ( params: KeyValue ) => Promise<ApiResponse>;
	getMessages: ( messageKeys: string[], params: KeyValue ) => Promise<ApiResponse>;
	postWithToken: ( token: string, params: KeyValue ) => any;
}

export interface IndexedDbData {
	key: string;
	value: any;
}
