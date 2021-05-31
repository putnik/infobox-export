import { getI18n } from "./i18n";
import { getConfig } from "./config";
import { userLanguage } from "./languages";

const $ = require('jquery');
const math = require('math');

/**
 * Formatting wikidata values for display to the user
 */
export function formatDataValue( datavalue ) {
	const $label = $( '<span>' );
	switch ( datavalue.type ) {
		case 'time':
			const bceMark = ( datavalue.value.time.charAt( 0 ) === '-' ? getI18n( 'bce-postfix' ) : '' );

			if ( datavalue.value.precision === 7 ) {
				$label.text( getConfig( 'centuries' )[ math.floor( ( datavalue.value.time.substr( 1, 4 ) - 1 ) / 100 ) ] + getI18n( 'age-postfix' ) + bceMark );
				break;
			}
			const options = {
				timeZone: 'UTC',
			};
			if ( datavalue.value.precision > 7 ) {
				options.year = 'numeric';
			}
			if ( datavalue.value.precision > 9 ) {
				options.month = 'long';
			}
			if ( datavalue.value.precision > 10 ) {
				options.day = 'numeric';
			}
			const parsedDate = new Date( Date.parse( datavalue.value.time.substring( 1 ).replace( /-00/g, '-01' ) ) );
			$label.text( parsedDate.toLocaleString( userLanguage, options ) + ( datavalue.value.precision === 8 ? getI18n( 'decade-postfix' ) : '' ) + bceMark );
			break;

		case 'quantity':
			$label.append( $( '<strong>' ).text( datavalue.value.amount ) );
			if ( datavalue.value.bound ) {
				$label.append( $( '<span>' ).text( ' ± ' + datavalue.value.bound ) );
			}
			if ( datavalue.value.unit !== '1' ) {
				const unitId = datavalue.value.unit.substr( datavalue.value.unit.indexOf( 'Q' ) );
				const name = ( ( getConfig( 'units' )[ unitId ] || {} ).label || {} ).value || unitId;
				const description = ( ( getConfig( 'units' )[ unitId ] || {} ).description || {} ).value || getI18n( 'no-description' );
				$label.append( '&nbsp;' ).append( $( '<abbr>' ).attr( 'title', description ).text( name ) );
			}
			break;

		case 'wikibase-entityid':
			$label.append( $( '<strong>' ).text( datavalue.value.label ? datavalue.value.label : datavalue.value.id ) )
				.append( datavalue.value.description ? ' — ' + datavalue.value.description : '' );
			break;
	}

	for ( const propertyId in datavalue.qualifiers ) {
		if ( !datavalue.qualifiers.hasOwnProperty( propertyId ) ) {
			continue;
		}
		if ( propertyId === 'P1480' && datavalue.qualifiers[ propertyId ][ 0 ].datavalue.value.id === 'Q5727902' ) {
			$label.prepend( $( '<abbr>' ).attr( 'title', getI18n( 'circa-title' ) ).text( getI18n( 'circa-prefix' ) ), ' ' );
		} else {
			const formatted = formatDataValue( datavalue.qualifiers[ propertyId ][ 0 ].datavalue );
			if ( formatted && $( '<span>' ).append( formatted ).text() ) {
				$label.append( $( '<span>' ).text( ' (' ).append( formatted ).append( ')' ) );
			}
		}
	}

	return $label;
}
