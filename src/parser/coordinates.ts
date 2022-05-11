import { Context } from '../types/main';
import { Reference, Snak, Statement } from '../types/wikidata/main';
import { GlobeCoordinateDataValue } from '../types/wikidata/datavalues';
import { convertSnakToStatement } from '../wikidata';
import { GlobeCoordinateValue } from '../types/wikidata/values';
import { Entity, PropertyId } from '../types/wikidata/types';
import { getReferences } from './utils';

export const earthGlobe: Entity = 'http://www.wikidata.org/entity/Q2';

function createGlobeCoordinateValue( latitude: number, longitude: number, precision: number ): GlobeCoordinateValue {
	return {
		latitude: latitude,
		longitude: longitude,
		altitude: null,
		precision: precision,
		globe: earthGlobe
	};
}

function createGlobeCoordinateSnak( value: GlobeCoordinateValue, propertyId: PropertyId ): Snak {
	const dataValue: GlobeCoordinateDataValue = {
		value: value,
		type: 'globecoordinate'
	};
	return {
		snaktype: 'value',
		property: propertyId,
		datavalue: dataValue,
		datatype: 'globe-coordinate'
	};
}

function convertCoordinates(
	latDeg: string,
	latMin: string,
	latSec: string,
	latDir: string,
	lonDeg: string,
	lonMin: string,
	lonSec: string,
	lonDir: string,
	precision: number | undefined
): number[] {
	let latitude: number = parseFloat( latDeg ) +
		parseFloat( latMin ) / 60 +
		parseFloat( latSec ) / 3600;
	if ( latDir.toUpperCase() === 'S' ) {
		latitude *= -1;
	}
	let longitude: number = parseFloat( lonDeg ) +
		parseFloat( lonMin ) / 60 +
		parseFloat( lonSec ) / 3600;
	if ( lonDir.toUpperCase() === 'S' ) {
		longitude *= -1;
	}
	return [ latitude, longitude, precision ];
}

function parseGeohackParams( url: string ): ( number | null )[] {
	let m: RegExpMatchArray | null;
	m = url.match( /params=(\d{1,2})_(\d{1,2})_(\d{1,2})_([NS])_(\d{1,2})_(\d{1,2})_(\d{1,2})_([WE])/i );
	if ( m ) {
		return convertCoordinates( m[ 1 ], m[ 2 ], m[ 3 ], m[ 4 ], m[ 5 ], m[ 6 ], m[ 7 ], m[ 8 ], 1 / 3600 );
	}
	m = url.match( /params=(\d{1,2})_(\d{1,2})_([\d.]+)_([NS])_(\d{1,2})_(\d{1,2})_([\d.]+)_([WE])/i );
	if ( m ) {
		return convertCoordinates( m[ 1 ], m[ 2 ], m[ 3 ], m[ 4 ], m[ 5 ], m[ 6 ], m[ 7 ], m[ 8 ], 1 / 36000 );
	}
	m = url.match( /params=(\d{1,2})_(\d{1,2})_([NS])_(\d{1,2})_(\d{1,2})_([WE])/i );
	if ( m ) {
		return convertCoordinates( m[ 1 ], m[ 2 ], '0', m[ 3 ], m[ 4 ], m[ 5 ], '0', m[ 6 ], 1 / 60 );
	}
	m = url.match( /params=(\d{1,2})_([\d.]+)_([NS])_(\d{1,2})_([\d.]+)_([WE])/i );
	if ( m ) {
		return convertCoordinates( m[ 1 ], m[ 2 ], '0', m[ 3 ], m[ 4 ], m[ 5 ], '0', m[ 6 ], 1 / 600 );
	}
	m = url.match( /params=([\d.]+)_([NS])_([\d.]+)_([WE])/i );
	if ( m ) {
		return convertCoordinates( m[ 1 ], '0', '0', m[ 2 ], m[ 3 ], '0', '0', m[ 4 ], 1 / 3600 );
	}
	m = url.match( /params=(-?[\d.]+)_(-?[\d.]+)/i );
	if ( m ) {
		return convertCoordinates( m[ 1 ], '0', '0', 'N', m[ 2 ], '0', '0', 'W', 1 / 3600 );
	}
	return [ null, null ];
}

export async function prepareGlobeCoordinate( context: Context ): Promise<Statement[]> {
	const statements: Statement[] = [];
	const $links: JQuery = context.$field.find( 'a' );
	$links.each( function () {
		const $link: JQuery = $( this );
		let latitude: number | null = null;
		let longitude: number | null = null;
		let precision: number = 1 / 3600;
		if ( $link.attr( 'data-lat' ) && $link.attr( 'data-lon' ) ) {
			latitude = parseFloat( $link.attr( 'data-lat' ) );
			longitude = parseFloat( $link.attr( 'data-lon' ) );
		} else {
			const href: string | undefined = $link.attr( 'href' );
			if ( href && ( href.includes( 'geohack.toolforge.org' ) || href.includes( 'tools.wmflabs.org/geohack' ) ) ) {
				[ latitude, longitude, precision ] = parseGeohackParams( href );
			}
		}

		if ( latitude && longitude ) {
			const value: GlobeCoordinateValue = createGlobeCoordinateValue( latitude, longitude, precision );
			const snak: Snak = createGlobeCoordinateSnak( value, context.propertyId );
			const references: Reference[] = getReferences( $( '<span>' ) );
			const statement: Statement = convertSnakToStatement( snak, references );
			statements.push( statement );
			return false;
		}
	} );

	return statements;
}
