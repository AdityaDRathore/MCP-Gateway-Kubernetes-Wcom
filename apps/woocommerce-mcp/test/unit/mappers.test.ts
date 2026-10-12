import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { projectOrder, projectProduct } from '../../src/woocommerce/mappers.js';
import { WooOrder, WooProduct } from '../../src/woocommerce/schemas.js';

describe('Output Projection & PII Redaction Unit Tests', () => {
  test('projectOrder strictly scrubs all customer PII, addresses, and phone numbers', () => {
    // Simulated raw WooCommerce order containing customer personal data
    const rawOrder: WooOrder & Record<string, unknown> = {
      id: 14,
      status: 'processing',
      currency: 'INR',
      total: '299.00',
      date_created: '2026-10-11T18:30:00Z',
      payment_method: 'cod',
      payment_method_title: 'Cash on delivery',
      // PII fields present in raw upstream WooCommerce response:
      customer_id: 42,
      customer_ip_address: '192.168.1.100',
      customer_user_agent: 'Mozilla/5.0 (X11; Linux x86_64)',
      customer_note: 'Please leave at front door',
      billing: {
        first_name: 'Aditya',
        last_name: 'Rathore',
        address_1: '123 Tech Street',
        address_2: 'Suite 400',
        city: 'Bengaluru',
        state: 'KA',
        postcode: '560001',
        country: 'IN',
        email: 'aditya@demo.local',
        phone: '+919876543210',
      },
      shipping: {
        first_name: 'Aditya',
        last_name: 'Rathore',
        address_1: '123 Tech Street',
        city: 'Bengaluru',
        postcode: '560001',
      },
      line_items: [
        {
          id: 101,
          name: 'Urumi Test Mug',
          product_id: 10,
          quantity: 1,
          subtotal: '299.00',
          total: '299.00',
          sku: 'URUMI-MUG-001',
        },
      ],
    };

    const projected = projectOrder(rawOrder);

    // Verify allowed fields are preserved
    assert.equal(projected.id, 14);
    assert.equal(projected.status, 'processing');
    assert.equal(projected.total, '299.00');
    assert.equal(projected.currency, 'INR');
    assert.equal(projected.payment_method, 'Cash on delivery');
    assert.equal(projected.line_items.length, 1);
    assert.equal(projected.line_items[0].sku, 'URUMI-MUG-001');

    // CRITICAL PRIVACY VERIFICATION: Assert zero customer PII fields exist
    const projectedKeys = Object.keys(projected);
    assert.ok(!projectedKeys.includes('billing'), 'Must not contain billing address');
    assert.ok(!projectedKeys.includes('shipping'), 'Must not contain shipping address');
    assert.ok(!projectedKeys.includes('customer_id'), 'Must not contain customer_id');
    assert.ok(!projectedKeys.includes('customer_ip_address'), 'Must not contain customer_ip_address');
    assert.ok(!projectedKeys.includes('customer_user_agent'), 'Must not contain customer_user_agent');
    assert.ok(!projectedKeys.includes('customer_note'), 'Must not contain customer_note');
    assert.ok(!projectedKeys.includes('email'), 'Must not contain email');
    assert.ok(!projectedKeys.includes('phone'), 'Must not contain phone');
  });

  test('projectProduct projects minimal model-friendly summary without raw metadata', () => {
    const rawProduct: WooProduct & Record<string, unknown> = {
      id: 10,
      name: 'Urumi Test Mug',
      slug: 'urumi-test-mug',
      type: 'simple',
      status: 'publish',
      sku: 'URUMI-MUG-001',
      price: '299',
      regular_price: '299',
      stock_status: 'instock',
      categories: [{ id: 16, name: 'Accessories', slug: 'accessories' }],
      // Metadata that must be excluded:
      meta_data: [{ id: 1, key: '_wp_page_template', value: 'default' }],
      description: '<p>Long HTML description...</p>',
      short_description: '<p>Short HTML...</p>',
    };

    const projected = projectProduct(rawProduct);

    assert.equal(projected.id, 10);
    assert.equal(projected.name, 'Urumi Test Mug');
    assert.equal(projected.sku, 'URUMI-MUG-001');
    assert.equal(projected.price, '299');
    assert.equal(projected.status, 'publish');
    assert.equal(projected.categories[0].name, 'Accessories');

    const projectedKeys = Object.keys(projected);
    assert.ok(!projectedKeys.includes('meta_data'), 'Must not expose raw metadata');
    assert.ok(!projectedKeys.includes('description'), 'Product projection omits full HTML description');
  });
});
