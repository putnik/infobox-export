import { getI18n } from './i18n';
import { wbFormatValue } from './wikidata';
import { ItemValue, TimeValue, UrlValue } from './types/wikidata/values';
import { ApiResponse } from './types/api';
import { wdApiRequest } from './api';
import { KeyValue } from './types/main';
import { allLanguages, contentLanguage, userLanguage } from './languages';
import { getConfig } from './config';
import { Reference, Snak } from './types/wikidata/main';

function getRefSup( url: string, text: string ): JQuery {
	const $link: JQuery = $( '<a>' )
		.attr( 'href', url )
		.attr( 'rel', 'noopener noreferrer' )
		.attr( 'target', '_blank' )
		.text( `[${text}]` );
	return $( '<sup>' )
		.addClass( 'infobox-export-sup' )
		.append( $link );
}

function formatReference( reference: Reference ): JQuery | void {
	const p854: Snak[] = reference.snaks.P854;
	if ( !p854 || !p854.length ) {
		return;
	}

	const url: UrlValue = p854[ 0 ].datavalue.value as UrlValue;
	let domain: string = url
		.replace( 'http://', '' )
		.replace( 'https://', '' )
		.replace( 'www.', '' );
	if ( domain.indexOf( '/' ) > 0 ) {
		domain = domain.substr( 0, domain.indexOf( '/' ) );
	}

	return getRefSup( url, domain );
}

export function formatReferences( references: Reference[] ): JQuery {
	const $result: JQuery = $( '<span>' );
	for ( let i = 0; i < references.length; i++ ) {
		const $refSup: JQuery | void = formatReference( references[ i ] );
		if ( $refSup ) {
			$result.append( $refSup );
		}
	}
	return $result;
}

export async function formatItemValue( value: ItemValue ): Promise<JQuery> {
	const data: ApiResponse = await wdApiRequest( {
		action: 'wbgetentities',
		ids: value.id,
		languages: allLanguages,
		props: [ 'labels', 'descriptions' ]
	} );
	const itemData: KeyValue = data.entities[ value.id ];
	const labelObject: KeyValue = itemData.labels[ userLanguage ] ||
		itemData.labels[ contentLanguage ] ||
		itemData.labels.en ||
		( Object.values( itemData.labels ).length ? Object.values( itemData.labels ).shift() : {} );
	const label: string = labelObject.value || value.id;
	const descriptionObject: KeyValue = itemData.descriptions[ userLanguage ] ||
		itemData.descriptions[ contentLanguage ] ||
		itemData.descriptions.en ||
		( Object.values( itemData.descriptions ).length ? Object.values( itemData.descriptions ).shift() : {} );
	const description: string | undefined = descriptionObject.value;

	const $mainLabel: JQuery = $( '<span>' )
		.addClass( 'infobox-export-main-label' )
		.html( label );
	const $wdLink: JQuery = getRefSup( `https://wikidata.org/wiki/${value.id}`, 'd' );
	const $label: JQuery = $( '<span>' ).append( $mainLabel, $wdLink );
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
		dateString = getConfig( `centuries.${century}` ) + getI18n( 'age-postfix' ) + bceMark;
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
		.append( $( '<span>' ).text( calendar ).addClass( 'infobox-export-calendar' ) );

	return $label;
}

/**
 * Formatting wikidata values for display to the user
 */
export async function formatSnak( snak: Snak ): Promise<JQuery> {
	if ( snak.snaktype === 'novalue' ) {
		return $( '<span>' )
			.addClass( 'infobox-export-novalue' )
			.text( getI18n( 'value-prefix' ) + getI18n( 'no-value' ) );
	}
	if ( snak.snaktype === 'somevalue' ) {
		return $( '<span>' )
			.addClass( 'infobox-export-somevalue' )
			.text( getI18n( 'value-prefix' ) + getI18n( 'unknown-value' ) );
	}

	switch ( snak.datatype ) {
		case 'time':
			// '''XIV century''' (Julian)
			return formatTimeValue( snak.datavalue.value as TimeValue );

		case 'wikibase-item':
			// '''Label''': description
			return formatItemValue( snak.datavalue.value as ItemValue );
	}

	return wbFormatValue( snak );
}
