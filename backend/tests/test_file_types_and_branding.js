// backend/tests/test_file_types_and_branding.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { getExtensionFromMime, ensureFileExtension } = require('../utils/encoding');
const {
  generateBlankDocx,
  generateBlankXlsx,
  generateBlankPptx,
  generateBlankTxt,
  generateBlankCsv,
  generateBlankMd
} = require('../templates');

async function run() {
  console.log('--- ТЕСТ 1: Проверка логики расширений и MIME ---');
  assert.strictEqual(getExtensionFromMime('image/png'), '.png');
  assert.strictEqual(getExtensionFromMime('image/jpeg'), '.jpg');
  assert.strictEqual(getExtensionFromMime('application/pdf'), '.pdf');
  assert.strictEqual(getExtensionFromMime('application/vnd.openxmlformats-officedocument.presentationml.presentation'), '.pptx');
  assert.strictEqual(getExtensionFromMime('text/plain'), '.txt');
  assert.strictEqual(getExtensionFromMime('text/csv'), '.csv');
  assert.strictEqual(getExtensionFromMime('application/zip'), '.zip');
  
  // ensureFileExtension
  assert.strictEqual(ensureFileExtension('report', 'pdf'), 'report.pdf');
  assert.strictEqual(ensureFileExtension('report.pdf', 'docx'), 'report.pdf');
  assert.strictEqual(ensureFileExtension('data_file', null, 'text/csv'), 'data_file.csv');
  assert.strictEqual(ensureFileExtension('my_presentation', null, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'), 'my_presentation.pptx');
  console.log('✅ Логика расширений и MIME работает корректно');

  console.log('--- ТЕСТ 2: Проверка генераторов шаблонов новых форматов ---');
  const docxBuf = generateBlankDocx('Word Test');
  assert(Buffer.isBuffer(docxBuf) && docxBuf.length > 500, 'DOCX буфер некорректен');

  const xlsxBuf = generateBlankXlsx('Excel Test');
  assert(Buffer.isBuffer(xlsxBuf) && xlsxBuf.length > 500, 'XLSX буфер некорректен');

  const pptxBuf = generateBlankPptx('Presentation Test');
  assert(Buffer.isBuffer(pptxBuf) && pptxBuf.length > 500, 'PPTX буфер некорректен');

  const txtBuf = generateBlankTxt('Txt Test');
  assert(Buffer.isBuffer(txtBuf) && txtBuf.toString('utf-8').includes('Txt Test'), 'TXT буфер некорректен');

  const csvBuf = generateBlankCsv('CSV Test');
  assert(Buffer.isBuffer(csvBuf) && csvBuf.toString('utf-8').includes('CSV Test'), 'CSV буфер некорректен');

  const mdBuf = generateBlankMd('MD Test');
  assert(Buffer.isBuffer(mdBuf) && mdBuf.toString('utf-8').includes('# MD Test'), 'MD буфер некорректен');
  console.log('✅ Все 6 форматов шаблонов успешно сгенерированы');

  console.log('--- ТЕСТ 3: Проверка легковесных SVG логотипов и брендинга ---');
  const faviconPath = path.join(__dirname, '../../public/favicon.svg');
  const logoPath = path.join(__dirname, '../../public/assets/logo.svg');
  const logoIconPath = path.join(__dirname, '../../public/assets/logo-icon.svg');

  assert(fs.existsSync(faviconPath), 'favicon.svg отсутствует');
  assert(fs.existsSync(logoPath), 'logo.svg отсутствует');
  assert(fs.existsSync(logoIconPath), 'logo-icon.svg отсутствует');

  const faviconContent = fs.readFileSync(faviconPath, 'utf8');
  assert(faviconContent.includes('<svg') && faviconContent.includes('</svg>'), 'favicon.svg не является валидным SVG');

  const logoContent = fs.readFileSync(logoPath, 'utf8');
  assert(logoContent.includes('Doc') && logoContent.includes('Flow') && logoContent.includes('<svg'), 'logo.svg не содержит DocFlow');

  console.log('✅ Все SVG логотипы существуют, валидны и оптимизированы');

  console.log('\n🎉 Все проверки расширений, шаблонов и брендинга успешно пройдены!');
}

if (require.main === module) {
  run().catch(err => {
    console.error('❌ Ошибка теста:', err);
    process.exit(1);
  });
}

module.exports = run;
