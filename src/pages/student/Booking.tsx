import RoomBooking from './RoomBooking'

// /booking is room booking only. Food boxes and vehicles have their own menu
// items (/food-boxes, /vehicles), and their order history lives in My Bookings.
export default function Booking() {
  return <RoomBooking standalone />
}
