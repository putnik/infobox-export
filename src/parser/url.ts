import { getReferences } from './utils';
import { sparqlRequest } from '../api';
import { addQualifierValue } from '../parser';
import { convertSnakToStatement } from '../wikidata';
import { SparqlResponse } from '../types/api';
import { Context, KeyValue } from '../types/main';
import { Reference, Snak, Statement } from '../types/wikidata/main';
import { EntityIdValue } from '../types/wikidata/values';
import { UrlDataValue } from '../types/wikidata/datavalues';

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
	const sparql = `SELECT ?item WHERE { ?item wdt:P218 ?value . FILTER ( ?value IN ("${Object.keys( codes ).join( '","' )}") ) }`;
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
		const url: string = $link.attr( 'href' ).replace( /^\/\//, 'https://' );

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

		statements.push( statement );
	} );

	if ( statements.length === 1 ) {
		await addLanguageQualifier( statements[ 0 ], context );
	}

	return statements;
}
