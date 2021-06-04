import { getI18n } from './i18n';
import { WikidataSnak } from './types/wikidata';
import { wbFormatValue } from './wikidata';
import { ItemValue, TimeValue } from './types/wikidata/values';
import { ApiResponse } from './types/api';
import { wdApiRequest } from './api';
import { KeyValue } from './types/main';
import { userLanguage } from './languages';
import { getConfig } from './config';

export async function formatItemValue( value: ItemValue ): Promise<JQuery> {
	const data: ApiResponse = await wdApiRequest( {
		action: 'wbgetentities',
		ids: value.id,
		languages: userLanguage,
		props: [ 'labels', 'descriptions' ]
	} );
	const itemData: KeyValue = data.entities[ value.id ];
	const label = itemData.labels[ userLanguage ].value; // FIXME
	const description = itemData.descriptions[ userLanguage ].value; // FIXME

	const $label = $( '<span>' ).append( $( '<strong>' ).html( label ) );
	if ( description ) {
		$label.append( $( '<span>' ).html( ' — ' + description ) );
	}
	return $label;
}

function formatTimeValue( value: TimeValue ): JQuery {
	const $label: JQuery = $( '<span>' );
	const bceMark: string = ( value.time.charAt( 0 ) === '-' ? getI18n( 'bce-postfix' ) : '' );

	let dateString: string;
	if ( value.precision === 7 ) {
		const century: number = Math.floor( ( parseInt( value.time.substr( 1, 4 ), 10 ) - 1 ) / 100 );
		dateString = getConfig( 'centuries' )[ century ] + getI18n( 'age-postfix' ) + bceMark;
	} else {
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
		dateString = parsedDate.toLocaleString( userLanguage, options ) + ( value.precision === 8 ? getI18n( 'decade-postfix' ) : '' ) + bceMark;
	}
	const calendar = value.calendarmodel.includes( '1985727' ) ? getI18n( 'grigorian-calendar' ) : getI18n( 'julian-calendar' );

	$label
		.append( $( '<strong>' ).text( dateString ) )
		.append( $( '<span>' ).text( calendar ).addClass( 'wikidata-infobox-export-calendar' ) );

	return $label;
}

/**
 * Formatting wikidata values for display to the user
 */
export async function formatSnak( snak: WikidataSnak ): Promise<JQuery> {
	if ( snak.qualifiers && JSON.stringify( snak.qualifiers ) === '{}' ) {
		snak.qualifiers = undefined;
	}

	let $label: JQuery;
	switch ( snak.type ) {
		case 'time':
			// '''XIV century''' (Julian)
			$label = await formatTimeValue( snak.value as TimeValue );
			break;

		case 'wikibase-item':
			// '''Label''': description
			$label = await formatItemValue( snak.value as ItemValue );
			break;

		default:
			$label = await wbFormatValue( snak );
	}

	const $: JQueryStatic = require( 'jquery' );
	for ( const qualifierPropertyId in snak.qualifiers ) {
		if ( !snak.qualifiers.hasOwnProperty( qualifierPropertyId ) ) {
			continue;
		}
		if ( qualifierPropertyId === 'P1480' && snak.qualifiers[ qualifierPropertyId ][ 0 ].datavalue.value.id === 'Q5727902' ) {
			$label.prepend( $( '<abbr>' ).attr( 'title', getI18n( 'circa-title' ) ).text( getI18n( 'circa-prefix' ) ), ' ' );
		} else {
			const $formatted: JQuery = await formatSnak( snak.qualifiers[ qualifierPropertyId ][ 0 ].datavalue );
			if ( $formatted && $( '<span>' ).append( $formatted ).text() ) {
				$label.append( $( '<span>' ).text( ' (' ).append( $formatted ).append( ')' ) );
			}
		}
	}

	return $label;
}
