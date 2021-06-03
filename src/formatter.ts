import { getI18n } from './i18n';
import { WikidataSnak } from './types/wikidata';
import { wbFormatValue } from './wikidata';

/**
 * Formatting wikidata values for display to the user
 */
export async function formatSnak( snak: WikidataSnak ): Promise<JQuery> {
	if ( snak.qualifiers && JSON.stringify( snak.qualifiers ) === '{}' ) {
		snak.qualifiers = undefined;
	}
	const $label: JQuery = await wbFormatValue( snak );

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
