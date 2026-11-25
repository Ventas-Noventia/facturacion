export function ventaEjemplo() {
  return { data: {
    order: { id: 1842, order_number: "ORD-20261008-K7Q2M", placed_at: "2026-10-08T17:41:09Z", paid_at: "2026-10-08T17:43:52Z", order_status: "preparing", currency: "MXN" },
    customer: { id: 10, name: "Comprador de prueba", email: "prueba@example.com" },
    invoice: { required: true, rfc: "XAXX010101000", legal_name: "CLIENTE DE PRUEBA", tax_regime: null, postal_code: null, cfdi_use: null },
    items: [
      { order_item_id: 1, product_listing_id: 10, sku: "SKU-1", name: "Artículo A", description: "Producto histórico A", unit_price: "1000.00", quantity: 1, subtotal: "1000.00", is_withdrawn: false },
      { order_item_id: 2, product_listing_id: 20, sku: "SKU-2", name: "Artículo B", description: "Producto histórico B", unit_price: "500.00", quantity: 1, subtotal: "500.00", is_withdrawn: false }
    ],
    totals: { subtotal: "1500.00", discount: "150.00", shipping: "99.00", total: "1449.00", currency: "MXN" },
    payment: { status: "paid", provider: "stripe", paid_at: "2026-10-08T17:43:52Z", amount: "1449.00", confirmed_refunded_amount: "0.00" },
    invoice_eligibility: { status: "eligible", reasons: [] }
  } };
}
export const jsonResponse = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
export const testConfig = { baseUrl: "https://api.example.com/api/v1/invoicing", username: "test-user", password: "test-password" };
export const tokenResponse = token => jsonResponse({ access_token: token, token_type: "Bearer", expires_in: 3600 });
