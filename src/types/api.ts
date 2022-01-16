import { KeyValue } from './main';

export type ApiResponse = {
	error?: {
		code: string;
		info: string;
	};
	[ key: string ]: any;
}

export type SparqlBinding = {
	'xml:lang'?: string;
	type: 'literal' | 'uri';
	value: string;
}

export type SparqlBindings = {
	[ key: string ]: SparqlBinding;
};

export type SparqlResponse = {
	results?: {
		bindings?: SparqlBindings[]
	}
}

export type SparqlUnitBindings = {
	unit: SparqlBinding;
	unitLabel?: SparqlBinding;
	unitAltLabel?: SparqlBinding;
	code?: SparqlBinding;
};

export type SparqlUnitsResponse = {
	results?: {
		bindings?: SparqlUnitBindings[]
	}
}

export interface MediaWikiApi {
	get: ( params: KeyValue ) => Promise<ApiResponse>;
	getMessages: ( messageKeys: string[], params: KeyValue ) => Promise<ApiResponse>;
	postWithToken: ( token: string, params: KeyValue ) => any;
}
