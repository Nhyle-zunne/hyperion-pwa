import { useLicenseStore } from '../../src/stores/licenseStore'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import TopLoadingIndicator from '../../src/components/TopLoadingIndicator'
import { beginPageLoading } from '../../src/lib/pageLoading'
import AdminPaymentsScreen from '../../src/screens/AdminPaymentsScreen'
import AdminQuestionBankScreen from '../../src/screens/AdminQuestionBankScreen'
import AdminLicensesScreen from '../../src/screens/AdminLicensesScreen'
import AccountScreen from '../../src/screens/AccountScreen'
import DesktopAccountMenu from '../../src/components/DesktopAccountMenu'
import BasketScreen from '../../src/screens/BasketScreen'
import OrdersPaymentHistoryScreen from '../../src/screens/OrdersPaymentHistoryScreen'
import { fixtureCalls, releaseFixtureEntitlements, switchFixtureAccount, releaseFixtureHeldNullSession, emitFixtureAuth } from '../../src/lib/supabase'
import StudyTimeScreen from '../../src/screens/StudyTimeScreen'
import { useStudyTimeStore } from '../../src/stores/studyTimeStore'
import '../../src/index.css'

Object.assign(window, {
  releaseFixtureEntitlements, switchFixtureAccount, releaseFixtureHeldNullSession, emitFixtureAuth,
  accountFixtureCalls: fixtureCalls, beginFixtureLoading: beginPageLoading,
  setFixtureOfflineLicense: (enabled: boolean) => useLicenseStore.setState({
    entitlementUserId: enabled ? '11111111-1111-4111-8111-111111111111' : null,
    entitlementsVerified: enabled, cloudTrackIds: enabled ? ['DECK_OIC_NW'] : [],
    isOicNwUnlocked: enabled, isAllAccessUnlocked: false
  })
})
document.documentElement.dataset.theme = 'light'
const section = new URLSearchParams(location.search).get('section')
if (section === 'question-editor') useLicenseStore.setState({ entitlementUserId: '11111111-1111-4111-8111-111111111111', isAllAccessUnlocked: true, entitlementsVerified: true })
if (section === 'study-time') useStudyTimeStore.setState({ selectedDate: '2026-11-14', segments: [
  { id: 'synthetic-deck-time', day: '2026-11-14', at: new Date(2026, 10, 14, 12).getTime(), durationMs: 900000, mode: 'PRACTICE', track: 'DECK_OIC_NW' },
  { id: 'synthetic-radio-time', day: '2026-11-14', at: new Date(2026, 10, 14, 12).getTime(), durationMs: 100000, mode: 'PRACTICE', track: 'GMDSS_GOC' }
] })
const initialPath = section === 'study-time' ? '/study-time' : section === 'account-menu' ? '/account?tab=licenses' : section === 'account' ? '/account?tab=payments' : section === 'admin' ? '/admin/licenses' : section === 'question-editor' ? '/admin/questions' : section === 'basket' ? '/BASKET' : section === 'orders' ? '/orders' : section === 'payment' ? '/checkout?payment=success&order_id=fixture-order' : '/checkout?buy_product=gmdss&buy_term=month'
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[initialPath]}>
  <TopLoadingIndicator />
  {section === 'account-menu' && <nav className="app-bottom-nav" aria-label="Main navigation"><DesktopAccountMenu /></nav>}
  <div className="route-transition">
  <Routes>
    <Route path="/study-time" element={<StudyTimeScreen />} />
    <Route path="/admin/payments" element={<AdminPaymentsScreen />} />
    <Route path="/admin/questions" element={<AdminQuestionBankScreen />} />
    <Route path="/admin/licenses" element={<AdminLicensesScreen />} />
    <Route path="/account" element={<AccountScreen key="account" />} />
    <Route path="/checkout" element={<AccountScreen key="checkout"><BasketScreen /></AccountScreen>} />
    <Route path="/basket" element={<AccountScreen key="basket"><BasketScreen /></AccountScreen>} />
    <Route path="/orders" element={<AccountScreen key="orders"><OrdersPaymentHistoryScreen /></AccountScreen>} />
  </Routes>
  </div>
</MemoryRouter>)
