import { parseRawQuantity } from "../src/text-parser";

const assert = require('assert');

const config = {
	"re-10_3": new RegExp( "thousand" ),
	"re-10_6": new RegExp( "million" ),
	"re-10_9": new RegExp( "billion" ),
	"re-10_12": new RegExp( "trillion" ),
};

describe('parseRawQuantity()', function() {
	it('should return amount for integer value with forceInteger=true', function() {
		const result = parseRawQuantity(config, '28300', true);
		assert.deepStrictEqual(result, {
			'amount': "28300",
		});
	});
	it('should return amount for integer value without forceInteger=true', function() {
		const result = parseRawQuantity(config, '28300');
		assert.deepStrictEqual(result, {
			'amount': "28300",
		});
	});
	it('should return integer amount for float value with forceInteger=true (comma)', function() {
		const result = parseRawQuantity(config, '28300,15', true);
		assert.deepStrictEqual(result, {
			'amount': "2830015",
		});
	});
	it('should return integer amount for float value with forceInteger=true (dot)', function() {
		const result = parseRawQuantity(config, '28300.15', true);
		assert.deepStrictEqual(result, {
			'amount': "2830015",
		});
	});
	it('should return amount for float value without forceInteger=true (comma)', function() {
		const result = parseRawQuantity(config, '28300,15');
		assert.deepStrictEqual(result, {
			'amount': "28300.15",
		});
	});
	it('should return amount for float value without forceInteger=true (dot)', function() {
		const result = parseRawQuantity(config, '28300.15');
		assert.deepStrictEqual(result, {
			'amount': "28300.15",
		});
	});
});
