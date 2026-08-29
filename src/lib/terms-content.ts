/**
 * THE SCHOOL'S TERMS AND CONDITIONS, verbatim.
 *
 * GENERATED FILE — do not edit by hand. Produced by scripts/extract-terms.mjs
 * from the .docx the school issued. Nothing here is paraphrased, condensed or
 * reordered: every sentence is the school's own, in the school's own order,
 * because this is the text a student is asked to agree to and a helpfully
 * shortened version of it is not the thing they agreed to.
 *
 * 58 sections, 242 paragraphs.
 *
 * The structure (a numbered section holding paragraph/bullet blocks) exists
 * because two of the three surfaces that render this have to address ONE
 * section rather than dump the lot — the refund wall opens on 23, not on 1.
 * See src/lib/terms.ts for the version string and the section groupings.
 */

export type TermsBlock = {
  /** `bullet` was a numbered or bulleted list item in the source document. */
  kind: "text" | "bullet";
  text: string;
};

export type TermsSection = {
  /** The school's own numbering — "1", "22A", "22AB", "30". Used to address a section. */
  number: string;
  title: string;
  blocks: TermsBlock[];
};

/** The statement of intent that opens the document. */
export const TERMS_PREAMBLE = "These Terms and Conditions are designed to maintain a high standard of learning, ensure fairness, and create a productive environment for all students.";

export const TERMS_SECTIONS: TermsSection[] = [
  {
    number: "1",
    title: "Attendance",
    blocks: [
      { kind: "bullet", text: "Students must maintain a minimum attendance of 70% in each course to qualify for promotion to the next level." },
      { kind: "bullet", text: "Students are expected to attend three (3) classes per week according to the official class schedule." },
      { kind: "bullet", text: "Students who miss classes are responsible for catching up on the lessons independently." },
      { kind: "bullet", text: "Continuous absenteeism without prior notification may result in suspension or removal from the class." },
    ],
  },
  {
    number: "2",
    title: "Hybrid Learning",
    blocks: [
      { kind: "bullet", text: "Students enrolled in the Hybrid Programme must attend three (3) classes per week, choosing either:" },
      { kind: "bullet", text: "Two (2) online classes and one (1) physical class, or" },
      { kind: "bullet", text: "Two (2) physical classes and one (1) online class." },
      { kind: "bullet", text: "Switching between physical and online attendance outside the approved schedule requires prior approval from the Academic Office." },
    ],
  },
  {
    number: "3",
    title: "Punctuality",
    blocks: [
      { kind: "bullet", text: "Students are expected to arrive before the scheduled class time." },
      { kind: "bullet", text: "Students arriving more than 30 minutes late may be marked absent for that class at the discretion of the tutor." },
      { kind: "bullet", text: "Repeated lateness may affect attendance records." },
    ],
  },
  {
    number: "4",
    title: "Course Progression",
    blocks: [
      { kind: "bullet", text: "Promotion to the next level is based on:" },
      { kind: "bullet", text: "Minimum attendance requirement." },
      { kind: "bullet", text: "Successful completion of assignments." },
      { kind: "bullet", text: "Passing the end-of-level assessment." },
      { kind: "bullet", text: "Satisfactory classroom participation." },
    ],
  },
  {
    number: "5",
    title: "Examinations",
    blocks: [
      { kind: "bullet", text: "Students are expected to sit for all scheduled internal examinations." },
      { kind: "bullet", text: "Examination malpractice, cheating, or any form of dishonesty may result in immediate disciplinary action or expulsion." },
      { kind: "bullet", text: "Students intending to register for external examinations (Goethe, ÖSD, Telc, etc.) are encouraged to complete the school's recommended preparation process." },
    ],
  },
  {
    number: "6",
    title: "Tuition Fees",
    blocks: [
      { kind: "bullet", text: "Tuition fees must be paid before or on the agreed payment deadline." },
      { kind: "bullet", text: "Students with outstanding fees may be denied access to classes, examinations, certificates, or other school services until payment has been completed." },
      { kind: "bullet", text: "Tuition fees are generally non-refundable once classes have commenced, except where otherwise stated in the school's refund policy." },
    ],
  },
  {
    number: "7",
    title: "Refund Policy",
    blocks: [
      { kind: "bullet", text: "Refund requests must be submitted in writing." },
      { kind: "bullet", text: "Administrative charges may apply where refunds are approved." },
      { kind: "bullet", text: "Students who voluntarily withdraw after classes have started may not be eligible for a refund." },
      { kind: "bullet", text: "Refund processing may take up to 30 working days after approval." },
    ],
  },
  {
    number: "8",
    title: "Leave of Absence",
    blocks: [
      { kind: "bullet", text: "Students requiring a temporary break must notify the school in writing before their absence." },
      { kind: "bullet", text: "The school may approve a class deferment depending on the circumstances and available class schedules." },
      { kind: "bullet", text: "Extended absence without approval may require the student to restart the course." },
    ],
  },
  {
    number: "9",
    title: "Classroom Conduct",
    blocks: [
      { kind: "text", text: "Students are expected to:" },
      { kind: "bullet", text: "Treat tutors, staff, and fellow students with respect." },
      { kind: "bullet", text: "Maintain a professional learning environment." },
      { kind: "bullet", text: "Avoid disruptive behaviour during classes." },
      { kind: "bullet", text: "Keep mobile phones on silent mode during lessons." },
      { kind: "bullet", text: "Follow all classroom instructions given by tutors." },
      { kind: "text", text: "Harassment, bullying, discrimination, abusive language, or threatening behaviour will not be tolerated." },
    ],
  },
  {
    number: "10",
    title: "Academic Integrity",
    blocks: [
      { kind: "bullet", text: "Assignments, tests, and projects must represent the student's own work." },
      { kind: "bullet", text: "Plagiarism, impersonation, or examination misconduct may result in disciplinary measures." },
    ],
  },
  {
    number: "11",
    title: "Travel Package Students",
    blocks: [
      { kind: "bullet", text: "Students enrolled in any travel package must submit all required documents within the stipulated timeline after registration." },
      { kind: "bullet", text: "Delays in document submission may affect processing timelines and travel opportunities." },
      { kind: "bullet", text: "Easyway German Language School is not responsible for delays caused by incomplete, inaccurate, or late document submission by the student." },
    ],
  },
  {
    number: "12",
    title: "Communication",
    blocks: [
      { kind: "bullet", text: "Official announcements are communicated through the school's approved communication channels." },
      { kind: "bullet", text: "Students are responsible for checking messages, emails, and WhatsApp announcements regularly." },
    ],
  },
  {
    number: "13",
    title: "Change of Class Schedule",
    blocks: [
      { kind: "bullet", text: "The school reserves the right to adjust class schedules, tutors, venues, or teaching methods where necessary to maintain academic quality or due to operational requirements." },
    ],
  },
  {
    number: "14",
    title: "Certificates",
    blocks: [
      { kind: "bullet", text: "Course completion certificates are issued only to students who:" },
      { kind: "bullet", text: "Meet the minimum attendance requirement." },
      { kind: "bullet", text: "Successfully complete the course." },
      { kind: "bullet", text: "Have no outstanding financial obligations to the school." },
    ],
  },
  {
    number: "15",
    title: "Photography and Media",
    blocks: [
      { kind: "bullet", text: "The school may take photographs or videos during classes or events for educational and promotional purposes." },
      { kind: "bullet", text: "Students who do not wish to appear in such materials should notify the school in writing before registration, as registration without a formal written request not to appear in the photographs and videos show consent." },
    ],
  },
  {
    number: "16",
    title: "Student Responsibilities",
    blocks: [
      { kind: "text", text: "Students are responsible for:" },
      { kind: "bullet", text: "Providing accurate personal information." },
      { kind: "bullet", text: "Updating the school whenever their contact details change." },
      { kind: "bullet", text: "Bringing required learning materials to class." },
      { kind: "bullet", text: "Completing assignments and independent study outside classroom hours." },
    ],
  },
  {
    number: "17",
    title: "School Property",
    blocks: [
      { kind: "text", text: "Students are expected to use school facilities responsibly. Any damage caused intentionally or through negligence may result in liability for repair or replacement costs." },
    ],
  },
  {
    number: "18",
    title: "Code of Conduct",
    blocks: [
      { kind: "text", text: "Easyway German Language School reserves the right to suspend or terminate a student's enrolment without refund in cases involving:" },
      { kind: "bullet", text: "Violent or threatening behaviour." },
      { kind: "bullet", text: "Theft or vandalism." },
      { kind: "bullet", text: "Examination malpractice." },
      { kind: "bullet", text: "Harassment of staff or students." },
      { kind: "bullet", text: "Conduct that damages the reputation of the school." },
      { kind: "bullet", text: "Any violation of Nigerian law while representing the school." },
    ],
  },
  {
    number: "19",
    title: "Immigration and Visa Services",
    blocks: [
      { kind: "text", text: "For students enrolled in migration, Ausbildung, or other travel packages:" },
      { kind: "bullet", text: "Admission into the programme does not guarantee visa approval, employment, or admission into a German institution." },
      { kind: "bullet", text: "Final decisions regarding visas, admissions, and work permits are made solely by the relevant German authorities and partner organisations." },
      { kind: "bullet", text: "Students are responsible for providing truthful and authentic documents at all times." },
    ],
  },
  {
    number: "20",
    title: "Amendments",
    blocks: [
      { kind: "text", text: "Easyway German Language School reserves the right to amend these Terms and Conditions whenever necessary. Students will be notified of any significant changes through the school's official communication channels." },
    ],
  },
  {
    number: "21",
    title: "Authenticity of Documents",
    blocks: [
      { kind: "text", text: "Students are solely responsible for the authenticity, accuracy, validity, and completeness of every document submitted to Easyway German Language School or any of its partners." },
      { kind: "text", text: "Easyway Language School/ Easyway German Language School does not create, alter, verify, or authenticate documents on behalf of students. Where a student submits forged, altered, misleading, expired, or otherwise invalid documents, ONLY the student shall bear full legal, financial, and administrative responsibility for any consequences arising therefrom." },
      { kind: "text", text: "Easyway German Language School shall not be liable for visa refusals, application rejections, criminal investigations, financial losses, bans, deportation, or any other consequence resulting from false, inaccurate, incomplete, or fraudulent documentation supplied by the student." },
      { kind: "text", text: "Any student found to have submitted fraudulent documents may have their enrolment or travel package terminated immediately without refund." },
    ],
  },
  {
    number: "22",
    title: "Student Declaration",
    blocks: [
      { kind: "text", text: "By registering with Easyway German Language School, every student declares that all information and documents provided are true, accurate, complete, and legally obtained." },
      { kind: "text", text: "Students further acknowledge that any false declaration or omission of material information may result in immediate cancellation of their enrolment or service without refund." },
    ],
  },
  {
    number: "22A",
    title: "Registration and Enrolment",
    blocks: [
      { kind: "bullet", text: "Registration for any course, programme, cohort, batch, examination preparation, travel package, or other service constitutes a formal commitment by the student to the selected programme." },
      { kind: "bullet", text: "Students are responsible for providing correct and complete information during registration." },
      { kind: "bullet", text: "A registration becomes valid only after the required payment and registration requirements have been completed." },
      { kind: "bullet", text: "Easyway German Language School reserves the right to decline or defer a registration where the required information, payment, or documentation has not been properly provided." },
      { kind: "bullet", text: "Registration for a particular cohort does not automatically guarantee admission into a different cohort where the student later requests a change." },
    ],
  },
  {
    number: "22B",
    title: "Cohort and Class Placement",
    blocks: [
      { kind: "bullet", text: "Students are registered according to the cohort, batch, level, schedule, and learning format selected at the time of registration." },
      { kind: "bullet", text: "Easyway may assign students to a particular class based on their level, availability, class size, timetable, and academic requirements." },
      { kind: "bullet", text: "Students may be required to complete a placement or level assessment before being assigned to a particular level." },
      { kind: "bullet", text: "Students who register for a particular cohort but fail to commence may be required to request a transfer to another available cohort." },
      { kind: "bullet", text: "Transfer to another cohort is subject to availability and approval by the Academic or Management Office." },
    ],
  },
  {
    number: "22C",
    title: "Course Materials and Learning Resources",
    blocks: [
      { kind: "bullet", text: "Students may receive access to learning materials, digital resources, class recordings, assignments, exercises, or other academic resources as determined by the school." },
      { kind: "bullet", text: "Learning materials provided by Easyway are intended for the registered student and must not be reproduced, sold, distributed, or shared commercially without written permission." },
      { kind: "bullet", text: "Access to digital learning platforms may be withdrawn when a student's programme expires, is terminated, or is otherwise completed." },
      { kind: "bullet", text: "Easyway may update, replace, or modify learning materials where necessary to improve the quality of instruction." },
    ],
  },
  {
    number: "22D",
    title: "Online Classes and Technical Requirements",
    blocks: [
      { kind: "bullet", text: "Students enrolled in online or hybrid classes are responsible for having access to a suitable internet connection and compatible device." },
      { kind: "bullet", text: "Students are responsible for ensuring that their devices, internet connection, camera, microphone, and other equipment are functioning properly." },
      { kind: "bullet", text: "Internet interruptions, power outages, device problems, or technical difficulties on the student's side do not automatically entitle the student to a refund or replacement class." },
      { kind: "bullet", text: "Where a technical problem is caused by Easyway and substantially affects a scheduled class, the school may, where reasonably possible, provide an alternative arrangement." },
      { kind: "bullet", text: "Students are expected to join online classes using their registered names and to comply with the school's online classroom rules." },
    ],
  },
  {
    number: "22E",
    title: "Class Recordings and Academic Content",
    blocks: [
      { kind: "bullet", text: "Where classes are recorded for academic purposes, access to such recordings may be provided at the discretion of Easyway." },
      { kind: "bullet", text: "Recordings are provided as supplementary learning resources and do not replace regular class attendance." },
      { kind: "bullet", text: "Students must not distribute, publish, sell, reproduce, or share class recordings without written permission from Easyway." },
      { kind: "bullet", text: "Easyway may restrict access to recordings or other digital resources where necessary for academic, administrative, technical, or disciplinary reasons." },
    ],
  },
  {
    number: "22F",
    title: "Tutors and Teaching Arrangements",
    blocks: [
      { kind: "bullet", text: "Easyway reserves the right to assign, replace, or change tutors where necessary." },
      { kind: "bullet", text: "A change of tutor does not constitute cancellation of a student's programme." },
      { kind: "bullet", text: "Teaching methods, class arrangements, learning platforms, and academic procedures may be adjusted where necessary to maintain the quality and continuity of the programme." },
      { kind: "bullet", text: "Students are expected to respect the professional authority of tutors and academic staff." },
      { kind: "bullet", text: "Concerns regarding a tutor or teaching arrangement should be formally communicated to the Academic or Management Office rather than through disruptive conduct in class." },
    ],
  },
  {
    number: "22G",
    title: "Academic Performance",
    blocks: [
      { kind: "bullet", text: "Students are responsible for actively participating in their learning and completing assignments and other academic requirements." },
      { kind: "bullet", text: "Easyway provides language instruction and academic support but cannot guarantee that every student will achieve a particular examination result." },
      { kind: "bullet", text: "Students are responsible for undertaking sufficient independent study outside scheduled classes." },
      { kind: "bullet", text: "A student's failure to study, attend classes, complete assignments, or prepare adequately for an examination does not constitute failure by Easyway to provide the programme." },
    ],
  },
  {
    number: "22H",
    title: "External Examination Registration",
    blocks: [
      { kind: "bullet", text: "Easyway may provide guidance regarding external examinations such as Goethe, ÖSD, telc, or other recognised examinations." },
      { kind: "bullet", text: "External examinations are conducted and administered by the relevant examination bodies." },
      { kind: "bullet", text: "Examination dates, availability, fees, locations, registration requirements, and examination results are subject to the policies of the relevant examination body." },
      { kind: "bullet", text: "Payment for an Easyway language course does not automatically include an external examination fee unless expressly stated." },
      { kind: "bullet", text: "Students are responsible for meeting all requirements for external examination registration." },
    ],
  },
  {
    number: "22I",
    title: "Changes to Programme Structure",
    blocks: [
      { kind: "bullet", text: "Easyway may make reasonable changes to course schedules, class times, venues, tutors, learning platforms, teaching methods, or other programme arrangements where necessary." },
      { kind: "bullet", text: "Such changes may be made due to operational requirements, tutor availability, class size, public holidays, technical issues, government directives, or other circumstances affecting the delivery of the programme." },
      { kind: "bullet", text: "Where reasonably possible, students will be informed of significant changes through the school's official communication channels." },
    ],
  },
  {
    number: "22J",
    title: "Public Holidays and Unscheduled Interruptions",
    blocks: [
      { kind: "bullet", text: "Classes may be affected by public holidays, school events, examinations, technical interruptions, emergencies, or other circumstances beyond the school's reasonable control." },
      { kind: "bullet", text: "Where necessary, Easyway may adjust the timetable or provide an alternative arrangement." },
      { kind: "bullet", text: "Students are expected to follow the revised schedule communicated through the school's official channels." },
    ],
  },
  {
    number: "22K",
    title: "Student Identification and Account Security",
    blocks: [
      { kind: "bullet", text: "Students are responsible for keeping their school account, LMS account, login details, passwords, and other access information secure." },
      { kind: "bullet", text: "Students must not share their LMS account or class access credentials with another person." },
      { kind: "bullet", text: "Easyway reserves the right to suspend access where there is evidence of unauthorised use or account sharing." },
      { kind: "bullet", text: "Students should immediately notify Easyway where they believe their account has been accessed or used without authorisation." },
    ],
  },
  {
    number: "22L",
    title: "Communication and Response to Official Notices",
    blocks: [
      { kind: "bullet", text: "Students are responsible for regularly checking their registered email address, phone number, WhatsApp communication, LMS account, and other approved communication channels." },
      { kind: "bullet", text: "Information sent through the school's official communication channels shall be deemed properly communicated to the student." },
      { kind: "bullet", text: "Students are responsible for keeping their contact information updated." },
      { kind: "bullet", text: "Failure to read or respond to an official communication does not automatically invalidate the communication." },
    ],
  },
  {
    number: "22M",
    title: "Student Personal Information",
    blocks: [
      { kind: "bullet", text: "Students consent to Easyway collecting and using information reasonably required for registration, academic administration, communication, examination preparation, programme management, and related services." },
      { kind: "bullet", text: "Where a student's information is required by an examination body, employer, recruitment partner, educational institution, immigration service provider, or other relevant third party, the student may be required to provide the necessary consent and documentation." },
      { kind: "bullet", text: "Students are responsible for ensuring that the personal information they provide is accurate and up to date." },
    ],
  },
  {
    number: "22N",
    title: "Third-Party Services and Partners",
    blocks: [
      { kind: "bullet", text: "Some programmes offered or facilitated by Easyway may involve third-party organisations, including examination bodies, employers, recruitment companies, educational institutions, immigration service providers, accommodation providers, financial institutions, or other partners." },
      { kind: "bullet", text: "Where a service depends on a third party, Easyway cannot guarantee the decision, availability, processing time, or actions of that third party." },
      { kind: "bullet", text: "Third-party fees, requirements, deadlines, policies, and decisions may apply in addition to Easyway's Terms and Conditions." },
      { kind: "bullet", text: "Students may be required to enter into separate agreements with third-party organisations where applicable." },
    ],
  },
  {
    number: "22O",
    title: "Student Cooperation",
    blocks: [
      { kind: "bullet", text: "Students are expected to cooperate fully with Easyway staff, tutors, consultants, partners, and other authorised representatives." },
      { kind: "bullet", text: "Students must provide requested information and documentation within the required timeframe." },
      { kind: "bullet", text: "Students must promptly notify Easyway of any change that may affect their programme, examination, placement, travel, or application." },
      { kind: "bullet", text: "Failure to cooperate or provide requested information may result in delays or the inability to continue with a particular service." },
    ],
  },
  {
    number: "22P",
    title: "Programme Completion and Expiry",
    blocks: [
      { kind: "bullet", text: "Students are expected to complete their programme within the applicable programme period." },
      { kind: "bullet", text: "Where a student is unable to complete a programme within the stated period, they may request a deferment or transfer where applicable." },
      { kind: "bullet", text: "Approval of a deferment or transfer is subject to availability and the applicable conditions of the programme." },
      { kind: "bullet", text: "Continued access to a programme after its stated duration is not automatic." },
    ],
  },
  {
    number: "22Q",
    title: "Deferment and Transfer",
    blocks: [
      { kind: "bullet", text: "A student who is unable to continue with their registered cohort may request a transfer or deferment where applicable." },
      { kind: "bullet", text: "Requests should be made before the student's absence or as soon as reasonably possible." },
      { kind: "bullet", text: "Approval is subject to the availability of future cohorts and the school's academic and administrative requirements." },
      { kind: "bullet", text: "A transfer or deferment does not automatically create an entitlement to a refund." },
      { kind: "bullet", text: "Any difference in fees applicable to a new programme or cohort may be payable by the student." },
    ],
  },
  {
    number: "22R",
    title: "Failure to Follow Programme Requirements",
    blocks: [
      { kind: "bullet", text: "Students who fail to meet attendance, academic, documentation, payment, conduct, or other programme requirements may be prevented from progressing or accessing certain services." },
      { kind: "bullet", text: "Where a student is unable to progress because they have failed to meet the requirements of the programme, the student may be required to repeat or restart the relevant level or process." },
      { kind: "bullet", text: "Additional fees may apply where a student is required to repeat a course, level, examination preparation programme, or other service." },
    ],
  },
  {
    number: "22S",
    title: "School Closure or Temporary Suspension",
    blocks: [
      { kind: "bullet", text: "Easyway may temporarily suspend classes or services where circumstances make it necessary or reasonably advisable to do so." },
      { kind: "bullet", text: "Such circumstances may include emergencies, government directives, security concerns, technical issues, public health concerns, operational requirements, or other circumstances beyond the school's reasonable control." },
      { kind: "bullet", text: "Where possible, Easyway may provide alternative arrangements to affected students." },
    ],
  },
  {
    number: "22T",
    title: "Force Majeure",
    blocks: [
      { kind: "bullet", text: "Easyway shall not be responsible for failure or delay in providing a service where such failure or delay results from circumstances beyond the reasonable control of the school." },
      { kind: "bullet", text: "Such circumstances may include natural disasters, government restrictions, strikes, civil unrest, war, pandemics, epidemics, major power or internet disruptions, changes in immigration regulations, closure of government offices, or other unforeseen circumstances." },
      { kind: "bullet", text: "Where such circumstances occur, Easyway may make reasonable adjustments to the programme or service." },
    ],
  },
  {
    number: "22U",
    title: "Intellectual Property",
    blocks: [
      { kind: "bullet", text: "All school materials, course content, presentations, recordings, documents, graphics, logos, learning resources, and other materials created or provided by Easyway remain the property of Easyway or their respective owners." },
      { kind: "bullet", text: "Students may use such materials for their personal educational purposes only." },
      { kind: "bullet", text: "Students must not reproduce, resell, distribute, publish, modify, or commercially exploit school materials without prior written permission." },
    ],
  },
  {
    number: "22V",
    title: "Third-Party Payments and Charges",
    blocks: [
      { kind: "bullet", text: "Where a student is required to make payments directly to an examination body, embassy, government authority, employer, recruitment organisation, travel provider, or other third party, such payments are subject to the terms of that third party." },
      { kind: "bullet", text: "Easyway is not responsible for charges imposed by third parties unless expressly agreed otherwise in writing." },
      { kind: "bullet", text: "Students are responsible for confirming third-party requirements and charges before making payments." },
    ],
  },
  {
    number: "22W",
    title: "No Verbal Modification of Terms",
    blocks: [
      { kind: "bullet", text: "Any agreement that changes or overrides these Terms and Conditions must be confirmed in writing by an authorised representative of Easyway German Language School." },
      { kind: "bullet", text: "Statements made informally by tutors, students, agents, consultants, or other persons who are not authorised to amend school policies shall not be regarded as a modification of these Terms and Conditions." },
      { kind: "bullet", text: "Students are encouraged to request written clarification where they are uncertain about any programme condition." },
    ],
  },
  {
    number: "22X",
    title: "Programme-Specific Terms",
    blocks: [
      { kind: "bullet", text: "Certain programmes may have additional terms and conditions specific to the programme." },
      { kind: "bullet", text: "Where a student registers for such a programme, the student may be required to accept the additional programme-specific terms." },
      { kind: "bullet", text: "In the event of a conflict between general school terms and programme-specific terms, the applicable programme-specific terms may apply to that particular service." },
    ],
  },
  {
    number: "22Y",
    title: "Management Discretion",
    blocks: [
      { kind: "bullet", text: "Easyway German Language School reserves the right to make reasonable administrative decisions necessary for the proper operation of its programmes." },
      { kind: "bullet", text: "Such decisions may include class placement, cohort allocation, deferment, transfer, scheduling, disciplinary action, access to school services, and other operational matters." },
      { kind: "bullet", text: "Where discretion is exercised, Easyway will endeavour to act fairly and consistently while taking into account the circumstances of the individual student and the interests of the school community." },
    ],
  },
  {
    number: "22Z",
    title: "Student Responsibility for Personal Decisions",
    blocks: [
      { kind: "bullet", text: "Students are responsible for making informed decisions before registering for a course, examination preparation programme, travel package, Ausbildung programme, or other service." },
      { kind: "bullet", text: "Students are encouraged to ask questions and seek clarification from Easyway before making payment." },
      { kind: "bullet", text: "Once a student has registered and made payment, the student is considered to have accepted the programme and the applicable Terms and Conditions." },
      { kind: "bullet", text: "A student's personal decision to discontinue a programme after registration does not automatically cancel the student's financial obligations or create an entitlement to a refund." },
    ],
  },
  {
    number: "22AA",
    title: "Entire Agreement",
    blocks: [
      { kind: "bullet", text: "These Terms and Conditions, together with any applicable programme-specific agreement or written agreement issued by Easyway, constitute the terms governing the student's relationship with Easyway German Language School." },
      { kind: "bullet", text: "Students should read all applicable terms carefully before making payment or commencing a programme." },
      { kind: "bullet", text: "Where a student has questions regarding any provision, the student should seek clarification from the school before registration." },
    ],
  },
  {
    number: "22AB",
    title: "Effective Date and Acceptance",
    blocks: [
      { kind: "bullet", text: "These Terms and Conditions apply to students who register for Easyway German Language School programmes from the effective date stated by the school." },
      { kind: "bullet", text: "By registering, making payment, attending a class, accessing the school's Learning Management System, or participating in a programme, the student acknowledges that they have had the opportunity to read and understand the applicable Terms and Conditions." },
      { kind: "bullet", text: "Continued participation in the programme constitutes acceptance of the applicable terms." },
    ],
  },
  {
    number: "23",
    title: "Refund Policy",
    blocks: [
      { kind: "text", text: "Tuition fees and service payments are made to reserve a place in a class or programme and to cover administrative, operational, academic costs and Learning System Management (LMS) Platform cost incurred by the school. Therefore, refunds are not automatic and shall ONLY be considered under the conditions stated below." },
      { kind: "text", text: "Refunds may NOT be granted because a student:" },
      { kind: "bullet", text: "Suddenly changes their mind after registration." },
      { kind: "bullet", text: "Is no longer interested in studying." },
      { kind: "bullet", text: "Obtains admission elsewhere." },
      { kind: "bullet", text: "Relocates voluntarily." },
      { kind: "bullet", text: "Experiences personal or financial difficulties." },
      { kind: "bullet", text: "Fails to attend classes." },
      { kind: "bullet", text: "Is unable to continue due to work, family, or other personal commitments." },
      { kind: "bullet", text: "Fails to meet programme requirements." },
      { kind: "bullet", text: "Is suspended or expelled for violating school policies." },
      { kind: "text", text: "Where a refund is approved by the Management of Easyway German Language School despite the stated reasons, administrative charges, processing charges and Learning System Management (LMS) Platform maintenance charges shall apply. This may lead to not more than 70% refund provided all requirements are met." },
      { kind: "text", text: "Easyway German Language School reserves the sole discretion to determine whether a refund request satisfies the conditions for approval." },
      { kind: "text", text: "Refund may be considered where:" },
      { kind: "bullet", text: "A student has registered and paid for a specific cohort, batch, or session, but the cohort, batch, or session is cancelled by Easyway Language School and is not postponed or rescheduled." },
      { kind: "bullet", text: "In such a case, Easyway may consider a refund for the affected programme, subject to the applicable payment processing and administrative costs already incurred." },
      { kind: "text", text: "Refund shall not be granted where:" },
      { kind: "bullet", text: "A candidate has paid for a Travel, Ausbildung, Placement, or other Germany-related package, and the travel or placement process has already commenced." },
      { kind: "bullet", text: "A candidate voluntarily withdraws from the travel package after Easyway has commenced the process, including documentation, consultations, applications, partner coordination, placement activities, or other related services." },
      { kind: "bullet", text: "A candidate changes their mind or decides not to travel after the process has commenced." },
    ],
  },
  {
    number: "24",
    title: "Refund Request Procedure",
    blocks: [
      { kind: "text", text: "All refund requests must be submitted by email to:" },
      { kind: "text", text: "germanprivateclass@gmail.com" },
      { kind: "text", text: "OR through our Learning System Management (LMS) Platform." },
      { kind: "text", text: "The request must include:" },
      { kind: "bullet", text: "Full name." },
      { kind: "bullet", text: "Phone number." },
      { kind: "bullet", text: "Course or package enrolled for." },
      { kind: "bullet", text: "Payment receipt." },
      { kind: "bullet", text: "Detailed reason for the refund request." },
      { kind: "bullet", text: "Supporting documents (where applicable)." },
      { kind: "text", text: "Refund requests submitted verbally, through WhatsApp, telephone calls, social media, third parties, or any email address other than germanprivateclass@gmail.com shall not be processed or considered." },
      { kind: "text", text: "Failure to follow this procedure automatically renders the refund request invalid." },
    ],
  },
  {
    number: "25",
    title: "Refund Processing Time",
    blocks: [
      { kind: "text", text: "Where a refund is approved, processing MAY take up to 30 days from the date of formal approval. This means the payment can be made within the next 30 days after approval." },
      { kind: "text", text: "Approval of a refund request does not guarantee immediate payment." },
    ],
  },
  {
    number: "26",
    title: "Non-Transferability",
    blocks: [
      { kind: "text", text: "Payments made to Easyway German Language School are non-transferable between students unless expressly approved in writing by the Management." },
    ],
  },
  {
    number: "27",
    title: "No Guarantee of Visa or Immigration Approval",
    blocks: [
      { kind: "text", text: "Easyway German Language School provides language training and, where applicable, assistance with documentation and partner processes." },
      { kind: "text", text: "The School does not guarantee:" },
      { kind: "bullet", text: "Visa approval." },
      { kind: "bullet", text: "Residence permit approval." },
      { kind: "bullet", text: "Employment." },
      { kind: "bullet", text: "University admission." },
      { kind: "bullet", text: "Embassy appointment availability." },
      { kind: "bullet", text: "Approval by any foreign authority." },
      { kind: "text", text: "All final decisions are made solely by the relevant embassy, immigration authorities, employers, educational institutions, or partner organizations." },
      { kind: "text", text: "Students acknowledge that visa refusal or delays do not constitute grounds for a refund unless otherwise agreed in writing." },
    ],
  },
  {
    number: "28",
    title: "Limitation of Liability",
    blocks: [
      { kind: "text", text: "Easyway German Language School shall not be liable for losses arising from:" },
      { kind: "bullet", text: "Government policy changes." },
      { kind: "bullet", text: "Embassy decisions." },
      { kind: "bullet", text: "Immigration regulations." },
      { kind: "bullet", text: "Employer decisions." },
      { kind: "bullet", text: "Partner institution decisions." },
      { kind: "bullet", text: "Airline cancellations." },
      { kind: "bullet", text: "Delays beyond the school's control." },
      { kind: "bullet", text: "Acts of God, pandemics, civil unrest, strikes, or other force majeure events." },
    ],
  },
  {
    number: "29",
    title: "Right to Refuse or Terminate Services",
    blocks: [
      { kind: "text", text: "Easyway German Language School reserves the right to refuse admission or terminate any student's enrolment without refund where the student:" },
      { kind: "bullet", text: "Provides false or misleading information." },
      { kind: "bullet", text: "Submits fraudulent documents." },
      { kind: "bullet", text: "Engages in criminal activity." },
      { kind: "bullet", text: "Harasses or threatens staff or other students." },
      { kind: "bullet", text: "Damages the school's reputation." },
      { kind: "bullet", text: "Violates school rules or Nigerian law." },
    ],
  },
  {
    number: "30",
    title: "Acceptance of Terms",
    blocks: [
      { kind: "text", text: "Payment of any tuition fee, registration fee, examination fee, or travel package fee constitutes full acceptance of these Terms and Conditions, whether or not the student has signed a physical copy." },
      { kind: "text", text: "The available electronic version on the Learning Management System constitute full acceptance and corporation." },
    ],
  },
];
