import { getConfig } from "./config";

function component() {
	const element = document.createElement('div');

	// Lodash, now imported by this script
	element.innerHTML = "getConfig(storageKey) = " + getConfig("storageKey");

	return element;
}

document.body.appendChild(component());
