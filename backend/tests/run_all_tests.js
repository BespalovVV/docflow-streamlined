// backend/tests/run_all_tests.js
const { runRbacTests } = require('./rbac.test');
const { runUserRoleTests } = require('./user_role.test');
const { runSecurityTests } = require('./security.test');
const { runApiIntegrationTests } = require('./api_integration.test');
const { runDocumentAclAndMailIsolationTests } = require('./document_acl_and_mail_isolation.test');
const db = require('../db');

async function main() {
  const startTime = Date.now();
  console.log('===============================================================');
  console.log('🧪 DOCFLOW STREAMLINED: КОМПЛЕКСНЫЙ ТЕСТОВЫЙ ПАКЕТ (TEST SUITE)');
  console.log('===============================================================');

  try {
    try {
      await db.initDb();
    } catch (dbErr) {
      console.log('⚠️ [DB Init] Предупреждение при инициализации базы данных:', dbErr.message);
    }

    // Setup temporary test user fixtures for the test suite
    const bcrypt = require('bcryptjs');
    const testUserHash = await bcrypt.hash('user123', 10);
    const testUsers = [
      [2, 'ivanov@docflow.local', 'Иван Иванов', 'USER', 'Отдел разработки', 1],
      [3, 'petrova@docflow.local', 'Анна Петрова', 'USER', 'Юридический отдел', 1],
      [4, 'sidorov@docflow.local', 'Алексей Сидоров', 'USER', 'Отдел разработки', 2],
      [5, 'kuznetsova@docflow.local', 'Елена Кузнецова', 'USER', 'Бухгалтерия', 1],
      [6, 'smirnov@docflow.local', 'Дмитрий Смирнов', 'USER', 'Отдел продаж', 1],
      [7, 'vlasova@docflow.local', 'Ольга Власова', 'USER', 'HR и кадры', 1],
      [8, 'morozov@docflow.local', 'Сергей Морозов', 'USER', 'Инфраструктура и DevOps', 1],
      [9, 'popova@docflow.local', 'Мария Попова', 'USER', 'Дизайн и UX', 1],
      [10, 'kozlov@docflow.local', 'Михаил Козлов', 'USER', 'Финансовый отдел', 1],
      [11, 'novikova@docflow.local', 'Екатерина Новикова', 'USER', 'Маркетинг', 1],
      [12, 'volkov@docflow.local', 'Артем Волков', 'USER', 'Отдел тестирования QA', 1]
    ];
    for (const [id, email, full_name, role, department, manager_id] of testUsers) {
      await db.query(`
        INSERT INTO users (id, email, password_hash, full_name, role, department, manager_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET 
          password_hash = EXCLUDED.password_hash, 
          role = EXCLUDED.role, 
          manager_id = EXCLUDED.manager_id
      `, [id, email, testUserHash, full_name, role, department, manager_id]);
    }
    await db.query("SELECT setval('users_id_seq', (SELECT MAX(id) FROM users))");

    await runRbacTests();
    await runUserRoleTests();
    await runSecurityTests();
    await runApiIntegrationTests();
    await runDocumentAclAndMailIsolationTests();
    await require('./new_features.test')();
    await require('./test_file_types_and_branding')();
    const { runDirectionsAndMaterialsTests } = require('./directions_and_materials.test');
    await runDirectionsAndMaterialsTests();
    const { runHierarchyAndIsolationTests } = require('./hierarchy_and_isolation.test');
    await runHierarchyAndIsolationTests();
    const { runPublicDocumentsTests } = require('./public_documents.test');
    await runPublicDocumentsTests();
    const { runSearchTests } = require('./search.test');
    await runSearchTests();
    const { runFullSystemScenariosTests } = require('./full_user_scenarios.test');
    await runFullSystemScenariosTests();
    const { runComprehensiveQATests } = require('./qa_comprehensive.test');
    await runComprehensiveQATests();

    // Clean up temporary test users so database remains clean
    await db.query('DELETE FROM users WHERE id BETWEEN 2 AND 12').catch(() => {});
    await db.query("SELECT setval('users_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM users), 1))").catch(() => {});

    const elapsedMs = Date.now() - startTime;
    console.log('\n===============================================================');
    console.log(`🎉 ВСЕ ТЕСТЫ УСПЕШНО ВЫПОЛНЕНЫ ЗА ${elapsedMs} мс!`);
    console.log('✅ 1. Ролевая модель RBAC (ADMIN / USER): PASSED');
    console.log('✅ 2. Тестирование роли USER (разрешения и 403 блокировки): PASSED');
    console.log('✅ 3. Безопасность (Crypto, Path Traversal, File Filter, Rate Limiter): PASSED');
    console.log('✅ 4. Интеграция API, токены и схема БД: PASSED');
    console.log('✅ 5. Изоляция почты и система прав на документы (Document ACL): PASSED');
    console.log('✅ 6. Новые возможности (папки, форматы, мессенджер, категории, повторения): PASSED');
    console.log('✅ 7. Расширенные форматы файлов (Word, Excel, PPTX, TXT, CSV, MD), расширения и SVG-брендинг: PASSED');
    console.log('✅ 8. Трёхуровневое подразделение (Направление -> Проект -> Материал): PASSED');
    console.log('✅ 9. Иерархия пользователей, строгая изоляция задач и документов: PASSED');
    console.log('✅ 10. Общедоступные документы (is_public) и разграничение прав доступа: PASSED');
    console.log('✅ 11. Сверхлегковесный умный поиск (FTS + Семантические чанки RAG): PASSED');
    console.log('✅ 12. Сквозные пользовательские сценарии (ONLYOFFICE, чаты, задачи, проекты) с откатом БД: PASSED');
    console.log('✅ 13. Глубокое QA-тестирование (Граничные случаи, SQL инъекции, RBAC-матрица, бенчмарк): PASSED');
    console.log('===============================================================\n');

    // Clean up DB pool connections so test runner exits cleanly
    try {
      await db.pool.end();
    } catch (e) {}

    process.exit(0);
  } catch (err) {
    console.error('\n❌ КРИТИЧЕСКИЙ СБОЙ ПРИ ТЕСТИРОВАНИИ:');
    console.error(err);
    console.log('===============================================================\n');

    try {
      await db.pool.end();
    } catch (e) {}

    process.exit(1);
  }
}

main();
