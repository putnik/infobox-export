import { ItemId, PropertyId } from './types/wikidata/types';
import { SparqlBindings, SparqlResponse } from './types/api';
import { sparqlRequest } from './api';
import { getProperty, loadProperties } from './config';
import { Property } from './types/main';
import { ClaimsObject, Statement } from './types/wikidata/main';
import { ItemValue } from './types/wikidata/values';

let availableProperties: PropertyId[] | undefined;

const propertyReplacements: { [key: PropertyId]: PropertyId } = {
	P276: 'P131',
	P6375: 'P669'
};

export async function preloadAvailableProperties( itemId: ItemId ): Promise<void> {
	const supportedTypes: string[] = [
		'CommonsMedia',
		'ExternalId',
		'GlobeCoordinate',
		'Monolingualtext',
		'Quantity',
		'String',
		'Time',
		'WikibaseItem',
		'Url'
	];
	const sparql: string = `SELECT DISTINCT (SUBSTR(STR(?property), 32) as ?pid) {
		?property rdf:type wikibase:Property.
		VALUES ?supportedTypes {wikibase:${supportedTypes.join( ' wikibase:' )}}.
		?property  wikibase:propertyType ?supportedTypes.
		?property p:P2302 ?scopeConstraint.
		?scopeConstraint ps:P2302 wd:Q53869507;
			pq:P5314 wd:Q54828448.
		OPTIONAL {
			?property p:P2302 ?classConstraint .
			?classConstraint ps:P2302 wd:Q21503250;
				pq:P2308 ?class.
			FILTER ( ?class != wd:Q29934200 )
		}
		FILTER( IF ( BOUND(?class),
			EXISTS { wd:${itemId} wdt:P31/wdt:P279* ?class. },
			NOT EXISTS { ?property wikibase:propertyType wikibase:ExternalId }
		) )
	}`;
	const data: SparqlResponse = await sparqlRequest( sparql );

	availableProperties = [];
	if ( !data?.results?.bindings?.length ) {
		return;
	}

	for ( let i = 0; i < data.results.bindings.length; i++ ) {
		const bindings: SparqlBindings = data.results.bindings[ i ];
		const propertyId: PropertyId = bindings.pid.value as PropertyId;
		availableProperties.push( propertyId );
	}
	await loadProperties( availableProperties );
}

export async function guessPropertyIdByLabel( $label: JQuery, itemId: ItemId, claims: ClaimsObject ): Promise<PropertyId[]> {
	if ( typeof availableProperties === 'undefined' ) {
		await preloadAvailableProperties( itemId );
	}
	const propertyIds: PropertyId[] = [];
	const label: string = $label.text().replace( /:$/, '' ).trim().toLowerCase();
	const baseLabel: string = label.replace( /\(.+?\)/, '' ).trim();

	for ( const propertyId of availableProperties ) {
		const property: Property = await getProperty( propertyId );
		if ( !property.aliases || !( property.aliases.includes( label ) || property.aliases.includes( baseLabel ) ) ) {
			continue;
		}

		// Property replacements
		if ( claims.P31?.length ) {
			const typeIds: ItemId[] = claims.P31.map(
				( statement: Statement ) => ( statement.mainsnak.datavalue?.value as ItemValue | undefined )?.id
			).filter( ( itemId: ItemId ) => itemId );
			const replacementIds: ( PropertyId | null )[] = typeIds.map(
				( typeId: ItemId ) => property.constraints.noneOfTypes[ typeId ]
			).filter( ( replacementIds: PropertyId ) => replacementIds !== undefined );
			if ( replacementIds.length ) {
				const replacementId: PropertyId = replacementIds.pop();
				if ( replacementId ) {
					propertyIds.push( replacementId );
				}
				continue;
			}
		}
		if ( propertyReplacements[ propertyId ] ) {
			propertyIds.push( propertyReplacements[ propertyId ] );
			continue;
		}

		propertyIds.push( propertyId );
	}
	return propertyIds;
}
