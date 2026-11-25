import test from "node:test";
import assert from "node:assert/strict";
import { crearPdfSimulado } from "../backend/services/simplePdfService.mjs";

test("genera un archivo PDF estructuralmente válido",()=>{
  const pdf=crearPdfSimulado(["NOVENTIA","Folio: NOV-FAC-000001","Total: $116.00 MXN"]);
  assert.equal(pdf.subarray(0,8).toString("ascii"),"%PDF-1.4");
  assert.match(pdf.toString("ascii"),/xref\n/);
  assert.match(pdf.toString("ascii"),/trailer\n/);
  assert.match(pdf.toString("ascii"),/%%EOF\n$/);
});
