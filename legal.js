// Foodol legal documents. Written to match exactly how the app works today.
// When Foodol starts handling data in a new way, update the text AND bump VERSION
// (restaurants are asked to accept the Restaurant Agreement again when VERSION changes).
const VERSION = '2026-11-20';
const UPDATED = 'November 20, 2026';

const CONTACT = 'our contact page at <a href="/contact">foodol.app/contact</a>';

const privacy = `
<p class="lead">Foodol helps you pick what to order at participating restaurants. This policy explains what information Foodol collects, why, who sees it, and the choices you have. We wrote it in plain language on purpose.</p>

<h2 id="summary">The short version</h2>
<ul>
<li>We collect only what we need to get your order to the restaurant and send you your code or receipt.</li>
<li>We <b>never see or store your card number</b>. Card payments are handled by the restaurant’s payment company (Square or Clover).</li>
<li>We share your order details with <b>the restaurant you order from</b>, and with the service providers that run Foodol. Nobody else.</li>
<li>We <b>do not sell</b> your personal information, and we do not share it for targeted advertising. Foodol has no ads and no advertising trackers.</li>
<li>You can ask us to show you, correct or delete your information at any time.</li>
</ul>

<h2 id="who">Who we are</h2>
<p>“Foodol”, “we” and “us” mean the operator of the Foodol service at foodol.app, based in California. Foodol works with independent restaurants (“restaurants”). Each restaurant is its own business: it prepares your food, sets its prices and runs its own promotions.</p>

<h2 id="collect">Information we collect</h2>
<h3>When you use Foodol at a restaurant (guests)</h3>
<table>
<tr><th>What</th><th>Examples</th><th>Why</th></tr>
<tr><td>Your choices</td><td>Party size, what you’re craving, the combo or items you pick</td><td>To suggest combos and build your order</td></tr>
<tr><td>Order details</td><td>Items, prices, total, tax, your 4-digit code, time of order, whether a free item was included</td><td>To place your order with the restaurant and show it your order</td></tr>
<tr><td>Contact details you give us</td><td>Email address; for online orders also your name and phone number</td><td>To send your code or receipt, and so the restaurant can reach you about a pickup order</td></tr>
<tr><td>Your marketing choice</td><td>Whether you ticked “Send me Foodol deals”</td><td>To respect your choice</td></tr>
<tr><td>Payment confirmation</td><td>Payment status and the restaurant’s order number from Square or Clover</td><td>To confirm your order was paid. <b>We never receive your full card number, expiry date or security code.</b></td></tr>
<tr><td>Basic technical information</td><td>IP address, browser type, the page you came from (for example a poster or table sticker)</td><td>To keep Foodol secure (for example, limiting repeated login attempts), fix problems, and see which posters work</td></tr>
</table>
<p><b>On your device:</b> Foodol saves a few things in your browser’s local storage so you don’t have to type them again: your open order, and the name, phone and email you last used at checkout. This stays on your device. You can clear it by clearing your browser’s site data. Foodol does not use advertising cookies or cross-site tracking.</p>

<h3>When a restaurant uses Foodol (restaurant accounts)</h3>
<ul>
<li><b>Account details:</b> the owner’s email address and password. Passwords are stored only in scrambled (hashed) form, never in readable text.</li>
<li><b>Menu information:</b> dishes, prices, categories, popular dishes, the free item and its minimum.</li>
<li><b>Point-of-sale (POS) connection:</b> if the restaurant connects Square or Clover, the keys it gives us. These keys stay on our servers and are never shown in any browser. Foodol uses them only to read the menu, price orders, send Foodol orders to the restaurant’s POS and charge the guest for those orders. Foodol does not read the restaurant’s other sales, customers, staff or bank details.</li>
<li><b>Sign-up requests:</b> if you ask about Foodol for your restaurant, the name, restaurant, email, phone and city you give us.</li>
</ul>
<p>Restaurant and admin logins use a single secure cookie that keeps you signed in. It is not used for tracking.</p>

<h2 id="use">How we use information</h2>
<ul>
<li>To run Foodol: suggest combos, create orders, send codes and receipts, and show each restaurant its own orders.</li>
<li>To give the restaurant you ordered from the details it needs to serve you.</li>
<li>To send you Foodol and restaurant offers <b>only if you opted in</b>. Every marketing email has an unsubscribe link.</li>
<li>To keep Foodol secure, prevent abuse of free-item offers, and fix problems.</li>
<li>To improve Foodol using combined, non-identifying statistics (for example, how often combos earn a free item).</li>
<li>To comply with the law.</li>
</ul>

<h2 id="share">Who we share information with</h2>
<ul>
<li><b>The restaurant you order from.</b> It sees your order, code, and the name, phone and email you gave for that order, plus whether you opted in to offers. Each restaurant sees only orders placed at that restaurant.</li>
<li><b>Payment companies.</b> For online orders, your card details go directly from your browser to Square or Clover (whichever the restaurant uses) and are handled under their privacy policies. The money goes to the restaurant, not to Foodol.</li>
<li><b>Service providers that run Foodol for us:</b> web hosting (Railway), email delivery (Resend), and services that deliver images and fonts. They may only use information to provide their service to us.</li>
<li><b>Legal reasons:</b> if required by law, or to protect the safety and rights of guests, restaurants or Foodol.</li>
<li><b>Business changes:</b> if Foodol is ever sold or merged, information may move to the new owner under this same policy.</li>
</ul>
<p>We do <b>not</b> sell personal information, and we do not “share” it for cross-context behavioral advertising as California law defines those terms.</p>

<h2 id="keep">How long we keep it</h2>
<ul>
<li>Order and guest information is kept while the restaurant uses Foodol, so the restaurant can see its history.</li>
<li>When a restaurant leaves Foodol, its menu, orders and guest list are deleted within 7 days of its request, and in any case within 30 days.</li>
<li>If you ask us to delete your information, we do so within 30 days, unless we must keep a record by law (for example, of a payment).</li>
</ul>

<h2 id="choices">Your choices and rights</h2>
<ul>
<li><b>Stop marketing emails:</b> click “Unsubscribe” in any email. You will still get the code or receipt for orders you place.</li>
<li><b>See, correct or delete your information:</b> contact us through ${CONTACT}. We may ask you to confirm the email or phone number you used, so we don’t give your information to someone else.</li>
<li><b>California residents</b> have the right to know what personal information we collect, use and disclose; to delete it; to correct it; and to opt out of its sale or sharing (we don’t sell or share it). We will not treat you differently for using these rights. You may also ask once a year whether we disclosed personal information to third parties for their direct marketing; we don’t.</li>
<li><b>Do Not Track:</b> Foodol doesn’t track you across other websites, so browser “Do Not Track” signals don’t change how Foodol works.</li>
</ul>

<h2 id="children">Children</h2>
<p>Foodol is meant for general audiences ordering food and is not directed to children under 13. We do not knowingly collect personal information from children under 13. If you believe a child has given us information, contact us and we will delete it.</p>

<h2 id="security">Security</h2>
<p>We use encrypted connections (HTTPS) everywhere, store passwords only in hashed form, keep payment and POS keys on our servers only, and limit who can access data. No system is perfectly secure, but we work to protect your information and will tell affected people if a breach affects them, as the law requires.</p>

<h2 id="changes">Changes to this policy</h2>
<p>If we change this policy, we will update the date at the top. If a change is significant, we will give notice on Foodol or by email before it takes effect.</p>

<h2 id="contact">Contact us</h2>
<p>Questions or requests about your information: ${CONTACT}.</p>
`;

const terms = `
<p class="lead">These terms apply when you use Foodol, including foodol.app and the Foodol page of any restaurant. By using Foodol, you agree to them. If you don’t agree, please don’t use Foodol.</p>

<h2 id="what">What Foodol is</h2>
<p>Foodol suggests dishes and combos from a restaurant’s menu and helps you place your order. <b>The restaurant is the seller.</b> It prepares your food, sets its menu and prices, runs its free-item offers and is responsible for your order. Foodol is the technology in between.</p>

<h2 id="orders">Orders, prices and payment</h2>
<ul>
<li>Menu items and prices come from the restaurant. We try to keep them current, but the restaurant’s price at the counter or in its POS applies if anything differs.</li>
<li>Prices shown before checkout don’t include tax. Tax is added by the restaurant, or shown before you pay for online orders.</li>
<li><b>Show-a-code orders:</b> Foodol gives you a code; you show it at the counter and pay the restaurant there.</li>
<li><b>Online orders:</b> you pay when you place the order. Your payment is processed by the restaurant’s payment provider (Square or Clover) and goes to the restaurant. Your order is for pickup unless the restaurant says otherwise.</li>
<li>Questions, problems, cancellations and refunds are handled by the restaurant. Foodol will help you reach them if needed.</li>
</ul>

<h2 id="free">Free-item offers</h2>
<ul>
<li>Some restaurants offer a free item when your order reaches a minimum amount (before tax). The item and minimum are shown in Foodol and set by the restaurant.</li>
<li>One free item per qualifying order unless the restaurant says otherwise. Codes are for one use at the restaurant that issued them.</li>
<li>To receive a free item you may be asked for your email address, so we can send you your code.</li>
<li>Free items have no cash value, can’t be exchanged or transferred, and are subject to availability. The restaurant may substitute a similar item, change the offer, or end it at any time.</li>
<li>Offers are void where prohibited. Misuse (for example, fake orders or automated sign-ups) may lead to codes being cancelled.</li>
</ul>

<h2 id="food">Food, allergies and dietary needs</h2>
<p>Foodol’s suggestions are based on popularity, price and what you tell us you’re craving. They are <b>not</b> nutrition, allergy or medical advice. Menu details, ingredients and claims such as “halal”, “vegetarian” or “gluten-free” come from the restaurant. If you have an allergy or dietary requirement, confirm with the restaurant before ordering.</p>

<h2 id="use">Using Foodol fairly</h2>
<p>Please don’t misuse Foodol: no fake or fraudulent orders, no attempts to get around free-item rules, no interfering with or overloading the service, no automated scraping, and no using someone else’s payment details. We may block access for misuse.</p>

<h2 id="ip">Foodol’s content</h2>
<p>The Foodol name, mascot, design and software belong to Foodol. Restaurant names, menus and photos belong to the restaurants. You may use Foodol for your personal, non-commercial ordering.</p>

<h2 id="privacy">Privacy</h2>
<p>Our <a href="/privacy">Privacy Policy</a> explains what information we collect and how we use it.</p>

<h2 id="disclaimer">Disclaimers</h2>
<p>Foodol is provided “as is”. We work hard to keep it accurate and available, but we can’t promise it will always be error-free or uninterrupted. To the extent the law allows, we disclaim implied warranties such as merchantability and fitness for a particular purpose. Nothing in these terms limits rights you have under consumer protection law that can’t be limited.</p>

<h2 id="liability">Limitation of liability</h2>
<p>To the extent the law allows, Foodol is not responsible for the food, service or conduct of restaurants, or for indirect or consequential losses. If Foodol is found liable to you, our total liability is limited to the greater of the amount you paid through Foodol in the order concerned or $50.</p>

<h2 id="law">Governing law</h2>
<p>These terms are governed by the laws of the State of California. Any dispute will be handled in the state or federal courts in Los Angeles County, California, unless the law where you live says otherwise.</p>

<h2 id="changes">Changes</h2>
<p>We may update these terms. The date at the top shows the latest version. If a change is significant, we’ll give notice on Foodol. Using Foodol after a change means you accept the updated terms.</p>

<h2 id="contact">Contact</h2>
<p>Questions about these terms: ${CONTACT}.</p>
`;

const restaurant = `
<p class="lead">This agreement is between Foodol and the restaurant that uses Foodol (“you”). It applies when you create or use a Foodol restaurant account, including during a free trial. You accept it by ticking “I agree” in your Foodol portal or by signing an order form that refers to it.</p>

<h2 id="service">1. The service</h2>
<p>Foodol gives your guests a Foodol page for your restaurant (for example foodol.app/your-restaurant) that suggests combos from your menu and helps them order, plus a portal where you manage your menu, popular dishes, free item and orders. Foodol may also connect to your point-of-sale (POS) system if you choose.</p>

<h2 id="trial">2. Free trial, fees and cancellation</h2>
<ul>
<li><b>Free trial:</b> unless agreed otherwise in writing, your first 7 days are free. Nothing is charged during the trial, and you can stop at any time.</li>
<li><b>Fees:</b> after the trial, fees are those in your order form, invoice or written quote from Foodol (monthly or yearly). Fees don’t include sales tax, which is added where it applies.</li>
<li><b>Cancelling:</b> you can cancel at any time by telling us in writing (email or through ${CONTACT}). Monthly plans end at the end of the current month. Yearly plans run to the end of the paid year and are not refunded for unused months, unless the law requires otherwise.</li>
<li><b>Foodol does not take a commission</b> on your orders.</li>
</ul>

<h2 id="you">3. Your responsibilities</h2>
<ul>
<li>Keep your menu, prices, ingredients and claims (such as halal, vegetarian or allergen information) accurate. You are the seller of all food ordered through Foodol.</li>
<li>Honor valid Foodol codes and the free-item offer you set, as long as it is shown in Foodol. You can change or turn off your free item at any time in your portal; the change applies to new orders.</li>
<li>Follow food safety, consumer protection and tax laws that apply to your business, including collecting and paying sales tax on your sales.</li>
<li>Handle guest questions, refunds and complaints about food and service.</li>
<li>Keep your portal password private and tell us if you think someone else has used it.</li>
</ul>

<h2 id="pos">4. POS connection (Square or Clover)</h2>
<ul>
<li>Connecting your POS is optional. You create the access keys yourself in your Square or Clover account and can delete them at any time, which immediately disconnects Foodol.</li>
<li>Foodol uses POS access <b>only</b> to: read your menu and prices, calculate tax on Foodol orders, create orders placed through Foodol, and charge guests for those orders.</li>
<li>Foodol does <b>not</b> read your other sales, reports, customers, employees, payouts or bank details, and does not change your menu, prices or settings in your POS.</li>
<li>Guest payments are processed by Square or Clover under <b>your</b> agreement with them and are paid to <b>your</b> account. Foodol never holds your money. Normal card processing fees from your provider apply.</li>
</ul>

<h2 id="data">5. Your data</h2>
<ul>
<li><b>You own your menu and your guest list.</b> Your guest list means the orders and contact details of guests who order at your restaurant through Foodol. You can view it in your portal and download it at any time.</li>
<li>Foodol uses your data only to provide and improve the service for you, as described in this agreement and our <a href="/privacy">Privacy Policy</a>.</li>
<li>Foodol <b>will not sell</b> your data, and will not share your guest list with other restaurants.</li>
<li>Guests who tick “Send me Foodol deals” agree to hear from Foodol. Foodol may send those guests offers about Foodol and about your restaurant. Foodol won’t use your guest list to promote a competing restaurant to them.</li>
<li>Foodol may use combined, anonymous statistics that don’t identify you or any guest (for example, average order size across restaurants) to improve Foodol and describe its results.</li>
<li>We will only name you as a Foodol customer (for example on our website) with your permission.</li>
</ul>

<h2 id="delete">6. When you leave: deletion</h2>
<p>If you stop using Foodol, including at the end of a free trial, you can ask us to delete your data. We will delete your menu, orders, guest list and POS keys within <b>7 days</b> of your request and confirm in writing. If you don’t ask, we delete them within <b>30 days</b> after your account ends. We may keep only records we are legally required to keep (such as invoices), and backups that expire on their normal schedule.</p>

<h2 id="security">7. Security and confidentiality</h2>
<p>Foodol protects your data with reasonable security measures, including encrypted connections, hashed passwords, and keeping POS keys on our servers only. Each of us will keep the other’s non-public business information confidential and use it only for this agreement. If we learn of a security incident affecting your data, we will tell you promptly.</p>

<h2 id="availability">8. Availability and changes</h2>
<p>We work to keep Foodol available and accurate, but it may sometimes be unavailable for maintenance or reasons outside our control. We may improve or change features. If we make a change that significantly reduces the service you pay for, you may cancel and receive a refund of any prepaid fees for the remaining period.</p>

<h2 id="warranty">9. Disclaimer</h2>
<p>Except as stated in this agreement, Foodol is provided “as is”. Combo suggestions are automated and based on the information you provide; Foodol doesn’t guarantee any specific increase in sales.</p>

<h2 id="liability">10. Limitation of liability</h2>
<p>To the extent the law allows, neither of us is liable to the other for indirect, incidental or consequential damages, or lost profits. Each party’s total liability under this agreement is limited to the fees you paid Foodol in the 12 months before the claim. These limits don’t apply to a party’s fraud, willful misconduct, or breach of the data and confidentiality promises in sections 5 to 7.</p>

<h2 id="indemnity">11. Claims from third parties</h2>
<p>You are responsible for claims by guests about your food, service, menu information and offers. Foodol is responsible for claims that the Foodol software itself infringes someone else’s rights.</p>

<h2 id="term">12. Ending this agreement</h2>
<p>Either of us may end this agreement at any time with written notice. Foodol may suspend an account that is used for fraud or seriously breaks this agreement. Sections 5, 6, 7, 10 and 11 continue after it ends.</p>

<h2 id="general">13. General</h2>
<ul>
<li>This agreement is governed by California law. Disputes will be handled in the courts of Los Angeles County, California.</li>
<li>If we update this agreement, we will tell you at least 30 days before the changes apply to you, and ask you to accept them in your portal. If you don’t agree, you may cancel before they take effect.</li>
<li>This agreement, together with any order form and our Privacy Policy, is the whole agreement about Foodol between us. If any part is unenforceable, the rest still applies.</li>
<li>Electronic acceptance (ticking “I agree”) counts as signing.</li>
</ul>

<h2 id="contact">Contact</h2>
<p>Questions about this agreement: ${CONTACT}.</p>
`;

module.exports = {
  VERSION, UPDATED,
  docs: {
    privacy: { path: '/privacy', title: 'Privacy Policy', html: privacy },
    terms: { path: '/terms', title: 'Terms of Use', html: terms },
    restaurant: { path: '/restaurant-terms', title: 'Restaurant Agreement', html: restaurant },
  },
};
