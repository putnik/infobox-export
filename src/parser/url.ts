import { createTimeValueFromDate } from './time';
import { getReferences } from './utils';
import { sparqlRequest } from '../api';
import { addQualifierValue } from '../parser';
import { convertSnakToStatement } from '../wikidata';
import type { SparqlResponse } from '../types/api';
import type { Context, KeyValue } from '../types/main';
import type { Reference, Snak, Statement } from '../types/wikidata/main';
import type { EntityIdValue } from '../types/wikidata/values';
import type { UrlDataValue } from '../types/wikidata/datavalues';

const webArchivePrefix = /^https?:\/\/web\.archive\.org\/web\/(\d{4})(\d{2})(\d{2})\d+\//;

async function addArchiveUrlQualifiers( statement: Statement, archiveUrl: string ): Promise<void> {
	addQualifierValue(
		statement,
		'P2241',
		'wikibase-item',
		{
			id: 'Q1193907'
		}
	);
	addQualifierValue(
		statement,
		'P1065',
		'url',
		archiveUrl
	);

	const archiveTimeParts: RegExpMatchArray = archiveUrl.match( webArchivePrefix );
	if ( archiveTimeParts.length === 4 ) {
		const archiveTime: Date = new Date(
			parseInt( archiveTimeParts[ 1 ], 10 ),
			parseInt( archiveTimeParts[ 2 ], 10 ),
			parseInt( archiveTimeParts[ 3 ], 10 )
		);
		addQualifierValue(
			statement,
			'P2960',
			'time',
			createTimeValueFromDate( archiveTime )
		);
	}
}

async function addLanguageQualifier( statement: Statement, context: Context ): Promise<void> {
	const codes: KeyValue = {};
	context.$field.find( 'span[lang]' ).each( function () {
		codes[ $( this ).attr( 'lang' ) ] = true;
	} );
	context.$field.find( 'span[data-lang]' ).each( function () {
		codes[ $( this ).data( 'lang' ) ] = true;
	} );
	if ( !Object.keys( codes ).length ) {
		return;
	}
	const sparql: string = `SELECT ?item WHERE { ?item wdt:P218 ?value . FILTER ( ?value IN ("${Object.keys( codes ).join( '","' )}") ) }`;
	const data: SparqlResponse = await sparqlRequest( sparql );
	for ( let i = 0; i < data.results.bindings.length; i++ ) {
		const langValue: EntityIdValue = {
			id: data.results.bindings[ i ].item.value.replace( /^.+\/(Q\d+)$/, '$1' )
		};
		addQualifierValue(
			statement,
			'P407',
			'wikibase-item',
			langValue
		);
	}
}

export async function prepareUrl( context: Context ): Promise<Statement[]> {
	const statements: Statement[] = [];
	const $links: JQuery = context.$field.find( 'a[href]' );
	const references: Reference[] = getReferences( context.$wrapper );
	$links.each( function () {
		const $link: JQuery = $( this );
		let url: string = $link.attr( 'href' ).replace( /^\/\//, 'https://' );
		let archiveUrl: string|null;

		if ( url.match( webArchivePrefix ) ) {
			archiveUrl = url;
			url = url.replace( webArchivePrefix, '' );
		}

		const dataValue: UrlDataValue = {
			type: 'string',
			value: url
		};
		const snak: Snak = {
			snaktype: 'value',
			property: context.propertyId,
			datavalue: dataValue,
			datatype: 'url'
		};
		const statement: Statement = convertSnakToStatement( snak, references );

		if ( archiveUrl ) {
			statement.rank = 'deprecated';
			addArchiveUrlQualifiers( statement, archiveUrl );
		}

		statements.push( statement );
	} );

	if ( statements.length === 1 ) {
		await addLanguageQualifier( statements[ 0 ], context );
	}

	return statements;
}
