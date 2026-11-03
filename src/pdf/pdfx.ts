// pdfx.ts — marks the combined print PDF as PDF/X-4: an sRGB output intent
// with its ICC profile embedded, GTS_PDFXVersion and Trapped in the Info
// dictionary, an XMP packet mirroring Info, and a trailer ID. The printer
// accepts RGB with an embedded profile and named no output condition, so
// the intent is sRGB; a printer ICC would replace SRGB_ICC and its name.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFStream, PDFString } from "pdf-lib";

/** sRGB-v2-magic.icc (736 bytes, "sRGB", ICC v2) from
 *  github.com/saucecontrol/Compact-ICC-Profiles, released under CC0. */
const SRGB_ICC =
  "AAAC4GxjbXMCEAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEA" +
  "AAAA0y1oYW5kk7I0qQ6wIoqY/Zqvo2eJmwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAABfY3BydAAA" +
  "AQwAAAAMd3RwdAAAARgAAAAUclhZWgAAASwAAAAUZ1hZWgAAAUAAAAAUYlhZWgAAAVQAAAAUclRSQwAAAWgAAAF4Z1RSQwAAAWgA" +
  "AAF4YlRSQwAAAWgAAAF4ZGVzYwAAAAAAAAAFc1JHQgAAAAAAAAAAAAAAAHRleHQAAAAAQ0MwAFhZWiAAAAAAAADzVAABAAAAARbJ" +
  "WFlaIAAAAAAAAG+gAAA48gAAA49YWVogAAAAAAAAYpYAALeJAAAY2lhZWiAAAAAAAAAkoAAAD4UAALbEY3VydgAAAAAAAAC2AAAA" +
  "HAA4AFQAcACMAKgAxADhAQABIgFGAW0BlQHBAfACIAJVAosCxAMBAz8DggPGBA4EWQSnBPkFTAWkBf4GXAa+ByEHigf0CGMI1QlJ" +
  "CcMKPwq/C0ILyQxUDOENdA4JDqIPQA/gEIURLRHaEooTPhP2FLIVcRY2Fv0XyhiZGW4aRhsiHAMc5x3QHr0friCkIZ4inCOfJKUl" +
  "sSbAJ9Uo7SoKKyssUS18Lqov3jEWMlIzlDTZNiQ3czjGOiA7fDzfPkU/sEEhQpZEEEWPRxJIm0ooS7tNUU7uUI9SNVPgVZBXRVkA" +
  "Wr5chF5MYBth72PHZaZniWlxa19tUW9KcUZzSnVRd155cXuIfaZ/yIHwhB6GUIiJisWNCY9RkZ+T85ZLmKubDp14n+eiW6TWp1ap" +
  "26xnrvexj7Qqtsy5dLwhvtXBjcRMxxDJ2syrz3/SXNU92CTbEt4E4P7j/OcB6gztHPA081D2c/mb/Mr//w==";

const ICC_NAME = "sRGB IEC61966-2.1";

/** Info's "D:20000101000000Z" date as XMP's "2000-01-01T00:00:00Z". */
const xmpDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The bytes the page draws: its content streams, in order. pdf-lib keeps
 *  them as an array once anything is drawn, which every print PDF is. */
function pageContents(doc: PDFDocument): Promise<ArrayBuffer> {
  const refs = doc.getPage(0).node.Contents() as PDFArray;
  const parts = refs.asArray().map((ref) => doc.context.lookup(ref, PDFStream).getContents());
  return new Blob(parts as BlobPart[]).arrayBuffer();
}

/** Save `doc` marked PDF/X-4. Call after the title is set: the XMP copies
 *  Info. The trailer ID and XMP DocumentID hash the page's content streams,
 *  so identical drawing still builds identical bytes. */
export async function savePdfX4(doc: PDFDocument): Promise<Uint8Array> {
  const { context, catalog } = doc;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await pageContents(doc)));
  const hex = [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const uuid = `uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

  context.trailerInfo.ID = context.obj([PDFHexString.of(hex), PDFHexString.of(hex)]);

  const icc = Uint8Array.from(atob(SRGB_ICC), (c) => c.charCodeAt(0));
  const profile = context.register(context.flateStream(icc, { N: 3 }));
  catalog.set(PDFName.of("OutputIntents"), context.obj([{
    Type: "OutputIntent",
    S: "GTS_PDFX",
    OutputConditionIdentifier: PDFString.of(ICC_NAME),
    RegistryName: PDFString.of("http://www.color.org"),
    Info: PDFString.of(ICC_NAME),
    DestOutputProfile: profile,
  }]));

  const info = context.lookup(context.trailerInfo.Info, PDFDict);
  info.set(PDFName.of("GTS_PDFXVersion"), PDFString.of("PDF/X-4"));
  info.set(PDFName.of("Trapped"), PDFName.of("False"));

  const created = xmpDate(doc.getCreationDate()!);
  const modified = xmpDate(doc.getModificationDate()!);
  const packet = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about=""
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:xmp="http://ns.adobe.com/xap/1.0/"
 xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
 xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
 xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">
<dc:format>application/pdf</dc:format>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(doc.getTitle() ?? "")}</rdf:li></rdf:Alt></dc:title>
<xmp:CreateDate>${created}</xmp:CreateDate>
<xmp:ModifyDate>${modified}</xmp:ModifyDate>
<xmp:MetadataDate>${modified}</xmp:MetadataDate>
<xmp:CreatorTool>${xml(doc.getCreator() ?? "")}</xmp:CreatorTool>
<pdf:Producer>${xml(doc.getProducer() ?? "")}</pdf:Producer>
<pdf:Trapped>False</pdf:Trapped>
<xmpMM:DocumentID>${uuid}</xmpMM:DocumentID>
<xmpMM:InstanceID>${uuid}</xmpMM:InstanceID>
<xmpMM:VersionID>1</xmpMM:VersionID>
<xmpMM:RenditionClass>default</xmpMM:RenditionClass>
<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  catalog.set(PDFName.of("Metadata"), context.register(context.stream(new TextEncoder().encode(packet), {
    Type: "Metadata",
    Subtype: "XML",
  })));

  // PDF/X-4 is built on PDF 1.6 and nothing this app writes needs 1.7, but
  // pdf-lib's writers hardcode "%PDF-1.7". Same length, so no offset moves.
  // objectsPerTick: one pass, no setTimeout yield every 50 objects. The
  // three added objects pushed the export suites' small mocked-font print
  // PDF over 50, and their faked clock never fired the yield. Bytes are the same.
  const bytes = await doc.save({ objectsPerTick: Infinity });
  bytes[7] = "6".charCodeAt(0);
  return bytes;
}
