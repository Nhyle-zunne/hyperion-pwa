import {expect,mock,test,afterEach} from 'bun:test'
mock.module('../../src/lib/supabase',()=>({supabase:null}))
const {useLicenseStore}=await import('../../src/stores/licenseStore')
const {canSyncCloudProgress,captureCloudProgressAccess}=await import('../../src/lib/cloudProgressAccess')
const grant=()=>useLicenseStore.setState({entitlementUserId:'a',entitlementsVerified:true,cloudSyncVerified:true,cloudTrackIds:['DECK_OIC_NW'],cloudSyncExpiresAt:Date.now()+60000})
afterEach(()=>useLicenseStore.setState(useLicenseStore.getInitialState(),true))
test('guest, unknown and verified free states cannot schedule progress requests',()=>{
 expect(canSyncCloudProgress(null)).toBe(false);expect(canSyncCloudProgress('a')).toBe(false)
 grant();useLicenseStore.setState({cloudTrackIds:[],cloudSyncExpiresAt:0})
 expect(canSyncCloudProgress('a')).toBe(false)
})
test('only an active signed grant for the same account enables sync',()=>{
 grant();expect(canSyncCloudProgress('a')).toBe(true);expect(canSyncCloudProgress('b')).toBe(false)
 useLicenseStore.setState({entitlementsVerified:false});expect(canSyncCloudProgress('a')).toBe(false)
})
test('cached local access alone cannot authorize background cloud traffic',()=>{grant();useLicenseStore.setState({cloudSyncVerified:false});expect(canSyncCloudProgress('a')).toBe(false)})
test('expiry stops requests even before asynchronous expiry refresh completes',()=>{
 grant();useLicenseStore.setState({cloudSyncExpiresAt:Date.now()-1,isAllAccessUnlocked:true})
 expect(canSyncCloudProgress('a')).toBe(false)
})
test('renewal never revalidates an operation issued before revocation',()=>{
 grant();const old=captureCloudProgressAccess('a');expect(old()).toBe(true)
 useLicenseStore.setState({cloudTrackIds:[],cloudSyncExpiresAt:0});expect(old()).toBe(false)
 grant();expect(old()).toBe(false);expect(captureCloudProgressAccess('a')()).toBe(true)
})
test('verified administrator grants remain eligible without a paid track expiry',()=>{
 grant();useLicenseStore.setState({cloudSyncExpiresAt:Infinity});expect(canSyncCloudProgress('a')).toBe(true)
})
