import { getI18n } from './i18n';
import { getConfig } from './config';
import { userLanguage } from './languages';
import { WikidataSnak } from './types/wikidata';
import { KeyValue } from './types/main';
import { EntityIdValue, QuantityValue, TimeValue } from './types/wikidata/values';

function formatEntityIdValue( value: EntityIdValue ): JQuery {
	const $label: JQuery = $( '<span>' );

	$label.append( $( '<strong>' ).html( value.label ? value.label : value.id ) )
		.append( value.description ? ' — ' + value.description : '' );

	return $label;
}

function formatQuantityValue( value: QuantityValue ): JQuery {
	const $label: JQuery = $( '<span>' );
	$label.append( $( '<strong>' ).text( value.amount ) );
	if ( value.bound ) {
		$label.append( $( '<span>' ).text( ' ± ' + value.bound ) );
	}
	if ( value.unit !== '1' ) {
		const unitId: string = value.unit.substr( value.unit.indexOf( 'Q' ) );
		const name: string = ( ( getConfig( 'units' )[ unitId ] || {} ).label || {} ).value || unitId;
		const description: string = ( ( getConfig( 'units' )[ unitId ] || {} ).description || {} ).value || getI18n( 'no-description' );
		$label.append( '&nbsp;' ).append( $( '<abbr>' ).attr( 'title', description ).text( name ) );
	}

	return $label;
}

function formatTimeValue( value: TimeValue ): JQuery {
	const $label: JQuery = $( '<span>' );
	const bceMark: string = ( value.time.charAt( 0 ) === '-' ? getI18n( 'bce-postfix' ) : '' );

	if ( value.precision === 7 ) {
		const century: number = Math.floor( ( parseInt( value.time.substr( 1, 4 ), 10 ) - 1 ) / 100 );
		$label.text( getConfig( 'centuries' )[ century ] + getI18n( 'age-postfix' ) + bceMark );
		return $label;
	}
	const options: KeyValue = {
		timeZone: 'UTC'
	};
	if ( value.precision > 7 ) {
		options.year = 'numeric';
	}
	if ( value.precision > 9 ) {
		options.month = 'long';
	}
	if ( value.precision > 10 ) {
		options.day = 'numeric';
	}

	const parsedDate = new Date( Date.parse( value.time.substring( 1 ).replace( /-00/g, '-01' ) ) );
	$label.text( parsedDate.toLocaleString( userLanguage, options ) + ( value.precision === 8 ? getI18n( 'decade-postfix' ) : '' ) + bceMark );

	return $label;
}

/**
 * Formatting wikidata values for display to the user
 */
export function formatSnak( snak: WikidataSnak ): JQuery {
	const $: JQueryStatic = require( 'jquery' );
	let $label: JQuery = $( '<span>' );

	switch ( snak.type ) {
		case 'time':
			// @ts-ignore
			$label = formatTimeValue( snak.value );
			break;

		case 'quantity':
			// @ts-ignore
			$label = formatQuantityValue( snak.value );
			break;

		case 'wikibase-entityid':
			// @ts-ignore
			$label = formatEntityIdValue( snak.value );
			break;
	}

	for ( const propertyId in snak.qualifiers ) {
		if ( !snak.qualifiers.hasOwnProperty( propertyId ) ) {
			continue;
		}
		if ( propertyId === 'P1480' && snak.qualifiers[ propertyId ][ 0 ].datavalue.value.id === 'Q5727902' ) {
			$label.prepend( $( '<abbr>' ).attr( 'title', getI18n( 'circa-title' ) ).text( getI18n( 'circa-prefix' ) ), ' ' );
		} else {
			const formatted: JQuery = formatSnak( snak.qualifiers[ propertyId ][ 0 ].datavalue );
			if ( formatted && $( '<span>' ).append( formatted ).text() ) {
				$label.append( $( '<span>' ).text( ' (' ).append( formatted ).append( ')' ) );
			}
		}
	}

	return $label;
}
