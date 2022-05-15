import { Context, Property } from '../types/main';
import { Reference, Snak, Statement } from '../types/wikidata/main';
import { getReferences } from './utils';
import { StringDataValue } from '../types/wikidata/datavalues';
import { convertSnakToStatement } from '../wikidata';
import { getProperty } from '../config';

function getCommonsCategoryName( $field: JQuery ): string | undefined {
	const $link: JQuery = $field.find( 'a[class="extiw"]' ).first();
	if ( !$link.length ) {
		return undefined;
	}

	const url: string = $link.attr( 'href' );
	let value = url.slice( url.indexOf( '/wiki/' ) + 6 )
		.replace( /_/g, ' ' )
		.replace( /^[Cc]ategory:/, '' )
		.replace( /\?.*$/, '' );
	value = decodeURIComponent( value );
	return value;
}

export async function prepareString( context: Context ): Promise<Statement[]> {
	const statements: Statement[] = [];
	let text: string = context.$field.data( 'wikidata-external-id' );
	if ( !text ) {
		text = context.text;
	}
	let strings: string[] = text.toString().trim().split( /[\n,;]+/ );

	// Commons category
	if ( context.propertyId === 'P373' ) {
		const commonsCategory: string | undefined = getCommonsCategoryName( context.$field );
		if ( typeof commonsCategory === 'undefined' ) {
			return [];
		}
		strings = [ commonsCategory ];
	}

	const references: Reference[] = getReferences( context.$wrapper );
	for ( const i in strings ) {
		let s: string = strings[ i ].replace( /\n/g, ' ' ).trim();

		if ( context.propertyId === 'P473' ) {
			// Local dialing code without trunk prefix
			s = s.replace( /^\+\d+\s+(\d[\d- ]*)$/, '$1' );
		}

		const property: Property | undefined = await getProperty( context.propertyId );
		if (
			property?.constraints?.format &&
			!s.match( new RegExp( '^(' + property.constraints.format + ')$' ) )
		) {
			continue;
		}

		if ( s ) {
			const dataValue: StringDataValue = {
				value: s,
				type: 'string'
			};
			const snak: Snak = {
				snaktype: 'value',
				property: context.propertyId,
				datavalue: dataValue,
				datatype: 'string'
			};
			const statement: Statement = convertSnakToStatement( snak, references );
			statements.push( statement );
		}
	}

	return statements;
}
