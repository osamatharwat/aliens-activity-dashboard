# ALIENS Activity Dashboard

داشبورد تفاعلية لمتابعة تقدم نشاط ALIENS، بهوية أخضر/أسود/أبيض وواجهة عربية RTL، قابلة للنشر على GitHub Pages.

## الميزات الحالية
- نظرة عامة بمؤشرات KPI ورسوم شهرية ومقارنة الإنجاز بالأهداف.
- فلاتر للفترة واللجنة.
- إنشاء وتعديل وحذف اللجان، مع روابط Google Forms وGoogle Sheets.
- تحديد هدف شهري ونوع المؤشر لكل لجنة.
- استيراد ملفات XLSX / XLS / CSV محليًا من المتصفح.
- تحديث بيانات CSV منشورة من Google Sheets (إذا كانت متاحة للقراءة العامة ويسمح CORS).
- تصدير ملخص وبيانات CSV.
- حفظ إعدادات اللجان والبيانات في LocalStorage داخل نفس المتصفح.
- GitHub Actions لنشر GitHub Pages تلقائيًا عند التحديث.

## النشر
1. افتح **Settings → Pages** في المستودع.
2. ضمن **Build and deployment** اختر **Source: GitHub Actions**.
3. ادفع الملفات إلى الفرع `main`. سير عمل GitHub Actions سيقوم بنشر الموقع.
4. بعد اكتمال الـ workflow، رابط الموقع سيكون عادةً:
   `https://osamatharwat.github.io/aliens-activity-dashboard/`

## استيراد ملف بيانات
من لوحة **إدارة البيانات** اختر ملف XLSX أو XLS أو CSV. يتم تحليل الملف داخل المتصفح ولا يتم رفع محتوياته إلى خدمة خلفية. يتم قراءة أول ورقة من Excel.

أسماء الأعمدة المقترحة (الأسماء العربية أو الإنجليزية المدعومة):
- `date` / `Date` / `التاريخ`
- `committee` / `Committee` / `اللجنة`
- `interactions` / `Interactions` / `التفاعلات`
- `tasks` / `Tasks` / `المهام المكتملة`
- `events` / `Events` / `الفعاليات`
- `registrations` / `Registrations` / `التسجيلات`
- `target` / `Target` / `الهدف`

مهم: اجعل الصف الواحد قياسًا واضحًا (مثلاً لجنة في تاريخ معيّن)، وتجنّب تكرار السجلات لأن الداشبورد تجمع الأرقام.

## ربط Google Sheets
- أضف اللجنة في **الإعدادات والمصادر**.
- رابط Sheet أو Form في الحقول الحالية للرجوع السريع وفتح المصدر.
- للتحديث الآلي من Google Sheets عبر المتصفح، انشر ورقة مخصصة **للقراءة العامة** كـ CSV واستخدم رابط التصدير في خانة CSV المنشور. لا تستخدم هذا الاختيار للبيانات الشخصية أو السرية. قد تمنع إعدادات Google/CORS طلبات المتصفح.
- للمصادر غير العامة، وللتحديث الآلي الموثوق، أنشئ طبقة وسيطة مثل Google Apps Script مع صلاحيات محدودة، أو Backend آمن. لا تضع مفاتيح API أو OAuth client secrets أو كلمات المرور في ملفات الموقع العامة.

## حدود الخصوصية والتشغيل
GitHub Pages يستضيف واجهة ثابتة فقط. هذه النسخة لا توفر مصادقة إدارية فعلية؛ «المؤشرات المجمعة فقط» تصميم وممارسة تشغيلية وليست حدًّا أمنيًا يضمن منع الوصول. لا ترفع بيانات شخصية إلى هذا الموقع العام، ولا تعتمد على إخفاء العناصر بالواجهة كحماية. بيانات LocalStorage تخص متصفحًا واحدًا ولا تتزامن تلقائيًا بين المستخدمين.

## البيانات التجريبية
المعاينة الأولية تستخدم سجلات افتراضية لتوضيح الرسوم، وتُوسم بوضوح بأنها بيانات تجريبية. استخدم **إدارة البيانات → استيراد ملف** لاستبدالها ببيانات النشاط الفعلية.


## Google Apps Script: automatic source inspection (new)

A starter backend is available at `apps-script/Code.gs`. It inspects the actual column headers and values in each registered spreadsheet, infers common fields in Arabic/English, and returns a schema report plus normalized dashboard data. It can discover fields such as date, event, organization, contact, follow-up date, status, outcome, report type, interactions, followers, messages, reach, tasks, and targets. Unknown columns are preserved instead of being discarded.

### Setup
1. Open [Google Apps Script](https://script.google.com/) using the Google account that has permission to read the source spreadsheets.
2. Create a new project named `ALIENS Dashboard Backend`.
3. Copy the contents of `apps-script/Code.gs` from this repository into the project's `Code.gs` file and save.
4. Run `setup` once from the editor and approve the requested permissions.
5. Register each source from the Apps Script editor. Example:
   ```javascript
   registerSource('PR', '1rAscFdi80tBkLEuG2uxIms92Zlx18CBz-XNM0mVsvOY');
   ```
   Use a spreadsheet ID, not the full URL. The ID is the segment between `/d/` and `/edit`. This command stores the ID in Script Properties, not in the public GitHub files. It reads the spreadsheet using the account that runs the script.
6. To inspect the inferred headers and sheet tabs, run `getSchemaReport_` from the editor, or deploy the web app and open its `?action=schema` endpoint.
7. To return dashboard data, use `?action=dashboard`; to test service availability, use `?action=health`.

### Deployment and safety notes
- The current Apps Script connector is **read-only**. It does not write to source spreadsheets or implement admin login yet.
- For an initial read-only test, deploy as a web app with an execution identity that can access the registered sheets. Carefully review who can access the deployment before publishing it. Do not expose personally identifying contact details from PR sheets in a public dashboard.
- The script returns source rows and detected headers for diagnostics. Before public launch, limit the response to safe aggregate fields or add an explicit public-field allowlist; do not expose personal names, email addresses, or phone numbers to anonymous visitors.
- Do not put passwords, password hashes, API keys, or private credentials in this repository. Admin authentication and protected settings changes must be implemented and tested separately before enabling writes.
- Google Forms are not spreadsheets. To analyze form submissions, link the Form to a response spreadsheet first, then register that response spreadsheet. This can be done later for Secretary.
- This connector is a first implementation of automatic schema detection, not a claim that every custom column's business meaning can be inferred perfectly. Review the generated schema report and use explicit mappings when labels are ambiguous.

## الملفات
- `index.html`: التطبيق الكامل.
- `.github/workflows/pages.yml`: نشر GitHub Pages عبر GitHub Actions.
- `data-template.csv`: قالب CSV أولي.
