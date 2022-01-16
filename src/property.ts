import { PropertyId } from './types/wikidata/types';
import { SparqlBindings, SparqlResponse } from './types/api';
import { sparqlRequest } from './api';
import { contentLanguage } from './languages';

let availableProperties: { [ key: PropertyId ]: string[] } | undefined;

export async function preloadAvailableProperties(): Promise<void> {
	const sparql: string = `SELECT DISTINCT ?property ?propertyLabel ?propertyAltLabel WHERE {
	  {
		  VALUES ?item {wd:Q689096}.
		  ?property p:P2302 ?constraint.
		  ?constraint ps:P2302 ?Q21503250;
		    pq:P2308 ?class.
		  ?item wdt:P31/wdt:P279* ?class.
	  } UNION {
		  ?property p:P2302 ?constraint.
		  FILTER NOT EXISTS {?constraint ps:P2302 wd:Q21503250.}.
	  }
	  SERVICE wikibase:label { bd:serviceParam wikibase:language "${contentLanguage}" }
	}`;
	const data: SparqlResponse = await sparqlRequest( sparql );

	availableProperties = {};
	if ( !data?.results?.bindings?.length ) {
		return;
	}

	for ( let i = 0; i < data.results.bindings.length; i++ ) {
		const bindings: SparqlBindings = data.results.bindings[ i ];
		const propertyId: PropertyId = bindings.property.value.replace( 'http://www.wikidata.org/entity/', '' ) as PropertyId;
		const propertyLabels: string[] = [];
		if ( bindings.propertyLabel?.value && bindings.propertyLabel.value !== propertyId ) {
			propertyLabels.push( bindings.propertyLabel.value.trim().toLowerCase() );
		}
		if ( bindings.propertyAltLabel?.value ) {
			bindings.propertyAltLabel.value.split( ',' ).forEach( function ( alias: string ) {
				propertyLabels.push( alias.trim().toLowerCase() );
			} );
		}
		if ( propertyLabels.length ) {
			availableProperties[ propertyId ] = propertyLabels;
		}
	}
}

export async function guessPropertyIdByLabel( $label: JQuery ): Promise<PropertyId[]> {
	if ( typeof availableProperties === 'undefined' ) {
		await preloadAvailableProperties();
	}
	const propertyIds: PropertyId[] = [];
	for ( const [ propertyId, propertyLabels ] of Object.entries( availableProperties ) ) {
		if ( propertyLabels.includes( $label.text().trim().toLowerCase() ) ) {
			propertyIds.push( propertyId as PropertyId );
		}
	}
	return propertyIds;
}
